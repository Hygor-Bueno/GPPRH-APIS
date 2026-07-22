const { poolGlobal } = require('../../../config/mysql');
const {
  sqlInsertExpense, buildInsertExpenseParams,
  sqlUpdateExpense, buildUpdateExpenseParams,
  sqlGetActiveWorkGroup, sqlGetVehicleIdByActiveId, sqlGetExpenseType,
  sqlInsertFuel, buildInsertFuelParams,
  sqlUpdateFuel, buildUpdateFuelParams,
  sqlInsertMaintenance, buildInsertMaintenanceParams,
  sqlUpdateMaintenance, buildUpdateMaintenanceParams,
  sqlInsertSinister, buildInsertSinisterParams,
  sqlUpdateSinister, buildUpdateSinisterParams,
  sqlInsertFine, buildInsertFineParams,
  sqlUpdateFine, buildUpdateFineParams,
  sqlLinkInsuranceToExpense, sqlGetInsuranceIdByExpenseId,
  sqlListExpenses, sqlCountExpenses,
  sqlListVehicleExpenses, sqlCountVehicleExpenses,
  sqlGetExpenseById
} = require('../repositories/mysql/gapp-expenses.repository');
const { sqlGetUserAuthByAccessCode } = require('../repositories/mysql/gapp-active.repository');
const {
  sqlSaveInsurance, sqlSelectInsuranceIdOut, buildSaveInsuranceParams
} = require('../repositories/mysql/gapp-insurance.repository');
const { AppError } = require('../../../errors/app.error');

/** @constant {Object.<number,string>} Campo do body exigido por exp_type_id_fk (6 = Outros, sem tabela de detalhe). */
const EXPENSE_TYPE_DETAIL_FIELD = {
  1: 'fuel',
  2: 'maintenance',
  3: 'sinister',
  4: 'fine',
  5: 'insurance',
};

const EXPENSE_TYPE = { FUEL: 1, MAINTENANCE: 2, SINISTER: 3, FINE: 4, INSURANCE: 5 };

class GappExpensesService {
  /**
   * Resolve o `user_id`/`work_group_fk` do usuário autenticado. Mesma lógica
   * usada em GappActiveService — nunca depende do que o cliente manda.
   *
   * @throws {AppError} 404 se o usuário autenticado não estiver no GAPP.
   */
  async _resolveGappUser(conn, currentUser) {
    const [[gappUser]] = await conn.query(sqlGetUserAuthByAccessCode(), [currentUser?.id]);
    if (!gappUser) {
      throw new AppError('Usuário autenticado não está cadastrado no GAPP (access_code não localizado)', 404);
    }
    return gappUser;
  }

  /**
   * Se `activeId` vier preenchido, garante que o ativo pertence ao
   * work_group_fk do usuário antes de aceitar o vínculo.
   *
   * @throws {AppError} 404 se o ativo não existir ou for de outro grupo.
   */
  async _assertActiveOwnership(conn, activeId, workGroupFk) {
    if (activeId == null) return;
    const [[active]] = await conn.query(sqlGetActiveWorkGroup(), [activeId]);
    if (!active || active.work_group_fk !== workGroupFk) {
      throw new AppError('Ativo não encontrado no seu grupo de trabalho', 404);
    }
  }

  _pickTypeDetail(data) {
    const field = EXPENSE_TYPE_DETAIL_FIELD[Number(data.exp_type_id_fk)];
    return field ? data[field] : null;
  }

  /**
   * Cria/atualiza a apólice de seguro vinculada à despesa, reaproveitando a
   * sp_gapp_save_insurance (mesma procedure de /gapp/insurance) — ela já
   * desativa a apólice ativa anterior do veículo antes de criar uma nova.
   * `vehicle_id_fk` é resolvido do `active_id_fk` da despesa, nunca do
   * cliente. No update, a apólice já vinculada (se houver) é atualizada
   * in-place — nunca recriada, porque um sinistro pode referenciá-la.
   *
   * @throws {AppError} 400 se não houver active_id_fk ou o ativo não for veículo.
   */
  async _saveInsuranceDetail(conn, detail, expenId, activeId, isUpdate) {
    if (activeId == null) {
      throw new AppError("Despesa do tipo Seguro exige 'active_id_fk' (usado pra resolver o veículo)", 400);
    }

    const [[vehicle]] = await conn.query(sqlGetVehicleIdByActiveId(), [activeId]);
    if (!vehicle) {
      throw new AppError('O ativo informado não é um veículo (sem registro em gapp_vehicle)', 400);
    }

    let existingInsuranceId = null;
    if (isUpdate) {
      const [[existing]] = await conn.query(sqlGetInsuranceIdByExpenseId(), [expenId]);
      existingInsuranceId = existing?.id_insurance ?? null;
    }

    const insurancePayload = {
      ...detail,
      id_insurance: existingInsuranceId,
      is_update: existingInsuranceId != null ? 1 : 0,
      vehicle_id_fk: vehicle.vehicle_id
    };

    await conn.execute(sqlSaveInsurance(), buildSaveInsuranceParams(insurancePayload));
    const [[{ id }]] = await conn.query(sqlSelectInsuranceIdOut());
    await conn.execute(sqlLinkInsuranceToExpense(), [expenId, id]);
  }

  /**
   * Grava o detalhe específico do tipo dentro da mesma transação da
   * despesa. `detail == null` (tipo 6 — Outros, ou tipo sem objeto
   * correspondente) não grava nada. `exp_type_id_fk` nunca muda depois de
   * criado (garantido pelo update, que recusa a troca), então no update a
   * linha de detalhe sempre já existe na tabela do tipo atual.
   */
  async _saveTypeDetail(conn, expTypeId, detail, expenId, activeId, isUpdate) {
    if (detail == null) return;

    switch (Number(expTypeId)) {
      case EXPENSE_TYPE.FUEL:
        if (isUpdate) await conn.execute(sqlUpdateFuel(), buildUpdateFuelParams(detail, expenId));
        else await conn.execute(sqlInsertFuel(), buildInsertFuelParams(detail, expenId));
        return;
      case EXPENSE_TYPE.MAINTENANCE:
        if (isUpdate) await conn.execute(sqlUpdateMaintenance(), buildUpdateMaintenanceParams(detail, expenId));
        else await conn.execute(sqlInsertMaintenance(), buildInsertMaintenanceParams(detail, expenId));
        return;
      case EXPENSE_TYPE.SINISTER:
        if (isUpdate) await conn.execute(sqlUpdateSinister(), buildUpdateSinisterParams(detail, expenId));
        else await conn.execute(sqlInsertSinister(), buildInsertSinisterParams(detail, expenId));
        return;
      case EXPENSE_TYPE.FINE:
        if (isUpdate) await conn.execute(sqlUpdateFine(), buildUpdateFineParams(detail, expenId));
        else await conn.execute(sqlInsertFine(), buildInsertFineParams(detail, expenId));
        return;
      case EXPENSE_TYPE.INSURANCE:
        await this._saveInsuranceDetail(conn, detail, expenId, activeId, isUpdate);
        return;
      default:
        return;
    }
  }

  async create(data, currentUser) {
    let conn;
    try {
      conn = await poolGlobal.getConnection();
      const gappUser = await this._resolveGappUser(conn, currentUser);
      await this._assertActiveOwnership(conn, data.active_id_fk, gappUser.work_group_fk);

      await conn.beginTransaction();

      const payload = { ...data, user_id_fk: gappUser.user_id };
      const [result] = await conn.execute(sqlInsertExpense(), buildInsertExpenseParams(payload));
      const expenId = result.insertId;

      const detail = this._pickTypeDetail(data);
      await this._saveTypeDetail(conn, data.exp_type_id_fk, detail, expenId, data.active_id_fk, false);

      await conn.commit();
      return { expen_id: expenId };
    } catch (error) {
      if (conn) { try { await conn.rollback(); } catch { /* conexão já pode ter caído */ } }
      if (error instanceof AppError) throw error;
      throw new AppError(error.message, 500);
    } finally {
      if (conn) conn.release();
    }
  }

  /**
   * Atualiza a despesa e seu detalhe. `exp_type_id_fk` é definitivo — não
   * pode ser alterado depois do cadastro (regra de negócio: o front tem
   * telas distintas por tipo, então trocar o tipo nunca deveria acontecer;
   * aqui é uma trava de segurança caso a API seja chamada fora dessas
   * telas). Como o tipo nunca muda, a linha de detalhe sempre já existe na
   * tabela certa, então é sempre UPDATE — nunca precisa criar/remover.
   *
   * @throws {AppError} 404 se a despesa não existir; 400 se tentar mudar exp_type_id_fk.
   */
  async update(id, data, currentUser) {
    let conn;
    try {
      conn = await poolGlobal.getConnection();
      const gappUser = await this._resolveGappUser(conn, currentUser);
      await this._assertActiveOwnership(conn, data.active_id_fk, gappUser.work_group_fk);

      const [[current]] = await conn.query(sqlGetExpenseType(), [id]);
      if (!current) throw new AppError('Despesa não encontrada', 404);
      if (Number(current.exp_type_id_fk) !== Number(data.exp_type_id_fk)) {
        throw new AppError("Não é possível alterar o tipo de uma despesa já registrada ('exp_type_id_fk')", 400);
      }

      await conn.beginTransaction();

      const payload = { ...data, expen_id: id };
      await conn.execute(sqlUpdateExpense(), buildUpdateExpenseParams(payload));

      const detail = this._pickTypeDetail(data);
      await this._saveTypeDetail(conn, current.exp_type_id_fk, detail, id, data.active_id_fk, true);

      await conn.commit();
      return { expen_id: id };
    } catch (error) {
      if (conn) { try { await conn.rollback(); } catch { /* conexão já pode ter caído */ } }
      if (error instanceof AppError) throw error;
      throw new AppError(error.message, 500);
    } finally {
      if (conn) conn.release();
    }
  }

  /**
   * Despesas de qualquer ativo (não exige que seja veículo), só com os
   * campos genéricos — sem o detalhe por tipo (ver getById pra isso).
   * Restrito ao work_group_fk do usuário.
   */
  async list(filters, currentUser) {
    let conn;
    try {
      conn = await poolGlobal.getConnection();
      const gappUser = await this._resolveGappUser(conn, currentUser);
      const scopedFilters = { ...filters, work_group_fk: gappUser.work_group_fk };

      const { sql, params } = sqlListExpenses(scopedFilters);
      const { sql: countSql, params: countParams } = sqlCountExpenses(scopedFilters);
      const [rows] = await conn.query(sql, params);
      const [[{ total }]] = await conn.query(countSql, countParams);
      return { items: rows, total, page: Number(filters.page) || 1, limit: Number(filters.limit) || 20 };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(error.message, 500);
    } finally {
      if (conn) conn.release();
    }
  }

  /**
   * Despesas restritas a ativos que são veículo, com filtros por placa,
   * unidade etc. — baseado na pcr_select_filtered_expenses (legado),
   * acrescentando o isolamento por work_group_fk.
   */
  async listVehicleExpenses(filters, currentUser) {
    let conn;
    try {
      conn = await poolGlobal.getConnection();
      const gappUser = await this._resolveGappUser(conn, currentUser);
      const scopedFilters = { ...filters, work_group_fk: gappUser.work_group_fk };

      const { sql, params } = sqlListVehicleExpenses(scopedFilters);
      const { sql: countSql, params: countParams } = sqlCountVehicleExpenses(scopedFilters);
      const [rows] = await conn.query(sql, params);
      const [[{ total }]] = await conn.query(countSql, countParams);
      return { items: rows, total, page: Number(filters.page) || 1, limit: Number(filters.limit) || 50 };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(error.message, 500);
    } finally {
      if (conn) conn.release();
    }
  }

  /**
   * Despesa com o detalhe do tipo aninhado (`fuel`/`maintenance`/`sinister`/
   * `fine`/`insurance` — o que não corresponder ao tipo vem `null`).
   * Restrito ao work_group_fk do usuário.
   */
  async getById(id, currentUser) {
    let conn;
    try {
      conn = await poolGlobal.getConnection();
      const gappUser = await this._resolveGappUser(conn, currentUser);

      const [rows] = await conn.query(sqlGetExpenseById(), [id, gappUser.work_group_fk]);
      if (!rows.length) throw new AppError('Despesa não encontrada', 404);

      return this._shapeExpenseDetail(rows[0]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(error.message, 500);
    } finally {
      if (conn) conn.release();
    }
  }

  /**
   * Reformata a linha (achatada, com todas as tabelas de detalhe em LEFT
   * JOIN) num objeto com os campos genéricos + um sub-objeto aninhado por
   * tipo, usando a chave primária de cada extensão para saber se ela veio
   * preenchida.
   */
  _shapeExpenseDetail(row) {
    const fuel = row.fuel_id != null ? {
      fuel_id: row.fuel_id,
      liter_value: row.liter_value,
      coupon_number: row.fuel_coupon_number,
      km_day: row.fuel_km_day,
      liter_qtd: row.liter_qtd,
      fuel_type_id_fk: row.fuel_type_id_fk,
      fuel_type_description: row.fuel_type_description,
      item_number: row.item_number,
      detail: row.fuel_detail
    } : null;

    const maintenance = row.maint_id != null ? {
      maint_id: row.maint_id,
      technician: row.technician,
      service_value: row.service_value,
      list_parts: row.list_parts,
      value_parts: row.value_parts,
      km_day: row.maint_km_day,
      km_next: row.km_next,
      date_next: row.date_next,
      warranty: row.warranty,
      validity: row.validity
    } : null;

    const sinister = row.sinister_id != null ? {
      sinister_id: row.sinister_id,
      guilty: row.guilty,
      victim: row.victim,
      finished: row.finished,
      others_documents: row.others_documents,
      data_third: row.data_third,
      bo_number: row.bo_number,
      bo_receipt_date: row.bo_receipt_date,
      bo_shipping_date: row.bo_shipping_date,
      observation: row.observation,
      damage_type_id_fk: row.damage_type_id_fk,
      damage_type_description: row.damage_type_description,
      id_insurance_fk: row.id_insurance_fk
    } : null;

    const fine = row.fine_id != null ? {
      fine_id: row.fine_id,
      infraction: row.fine_infraction,
      ait: row.ait,
      gravity: row.gravity,
      points: row.points,
      article_ctb: row.article_ctb,
      offending_driver_date: row.offending_driver_date,
      offending_driver: row.offending_driver,
      infraction_id_fk: row.infraction_id_fk,
      infraction_description: row.infraction_description
    } : null;

    const insurance = row.id_insurance != null ? {
      id_insurance: row.id_insurance,
      risk_cep: row.risk_cep,
      adjustment_factor: row.adjustment_factor,
      deductible_type: row.deductible_type,
      shielding: row.shielding,
      property_damage: row.property_damage,
      bodily_damages: row.bodily_damages,
      moral_damages: row.moral_damages,
      glasses: row.glasses,
      assist_24hrs: row.assist_24hrs,
      km_trailer: row.km_trailer,
      backup_car: row.backup_car,
      policy_number: row.policy_number,
      proposal_number: row.proposal_number,
      date_init: row.date_init,
      date_final: row.date_final,
      bodywork: row.bodywork,
      iof_value: row.iof_value,
      insurance_value: row.insurance_value,
      deductible_value: row.deductible_value,
      form_payment: row.form_payment,
      franchise_list: row.franchise_list,
      status_insurance: row.status_insurance,
      ins_id_fk: row.ins_id_fk,
      cov_id_fk: row.cov_id_fk,
      util_id_fk: row.util_id_fk,
      vehicle_id_fk: row.vehicle_id_fk
    } : null;

    return {
      expen_id: row.expen_id,
      date: row.date,
      hour: row.hour,
      local: row.local,
      description: row.description,
      total_value: row.total_value,
      discount: row.discount,
      provider: row.provider,
      exp_type_id_fk: row.exp_type_id_fk,
      description_type: row.description_type,
      driver_id_fk: row.driver_id_fk,
      active_id_fk: row.active_id_fk,
      user_id_fk: row.user_id_fk,
      status_expen: row.status_expen,
      coupon_number: row.coupon_number,
      store_id_fk: row.store_id_fk,
      created_at: row.created_at,
      updated_at: row.updated_at,
      fuel,
      maintenance,
      sinister,
      fine,
      insurance
    };
  }
}

module.exports = { GappExpensesService };
