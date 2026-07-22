const { poolGlobal } = require('../../../config/mysql');
const {
  sqlSaveActive, sqlSelectActiveIdOut, buildSaveActiveParams,
  sqlListActive, sqlCountActive, sqlGetActiveById,
  sqlGetVehicleByActiveId, sqlGetActiveInsuranceByVehicleId,
  sqlGetUserAuthByAccessCode, sqlGetIsVehicleByActiveId
} = require('../repositories/mysql/gapp-active.repository');
const { AppError } = require('../../../errors/app.error');

class GappActiveService {
  /**
   * Resolve o `user_id`/`work_group_fk` do usuário autenticado (JWT `id` →
   * `gapp_user.access_code` → `gapp_level.group_id_fk`). Usado por save/list/
   * getById para nunca depender do que o cliente manda no body/query.
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
   * `user_id_fk` e `work_group_fk` nunca vêm do body — são sempre resolvidos
   * a partir do usuário autenticado. Isso vale tanto pra criação quanto
   * atualização.
   *
   * No update, `is_vehicle` é opcional: se o cliente não mandar, mantém o
   * valor atual do ativo em vez de assumir um default (evita transformar um
   * ativo-veículo em não-veículo só porque o PUT não reenviou o campo).
   */
  async save(data, currentUser) {
    let conn;
    try {
      conn = await poolGlobal.getConnection();
      const gappUser = await this._resolveGappUser(conn, currentUser);

      let isVehicle = data.is_vehicle;
      if (data.active_id && isVehicle == null) {
        const [[current]] = await conn.query(
          sqlGetIsVehicleByActiveId(),
          [data.active_id, gappUser.work_group_fk]
        );
        if (!current) throw new AppError('Ativo não encontrado', 404);
        isVehicle = current.is_vehicle;
      }

      const payload = {
        ...data,
        is_vehicle: isVehicle,
        user_id_fk: gappUser.user_id,
        work_group_fk: gappUser.work_group_fk
      };

      await conn.execute(sqlSaveActive(), buildSaveActiveParams(payload));
      const [[{ id, insurance_id }]] = await conn.query(sqlSelectActiveIdOut());
      return insurance_id != null ? { id, insurance_id } : { id };
    } catch (error) {
      if (error instanceof AppError) throw error;
      // SQLSTATE 45000 = erro de negócio sinalizado pela procedure
      // (ex.: violação de campo obrigatório na tabela) → 400.
      const status = error.sqlState === '45000' ? 400 : 500;
      throw new AppError(error.sqlMessage || error.message, status);
    } finally {
      if (conn) conn.release();
    }
  }

  /**
   * `work_group_fk` no filtro nunca vem da query string — é sempre o grupo
   * de trabalho do usuário autenticado, garantindo que cada um só veja os
   * ativos do próprio grupo.
   */
  async list(filters, currentUser) {
    let conn;
    try {
      conn = await poolGlobal.getConnection();
      const gappUser = await this._resolveGappUser(conn, currentUser);
      const scopedFilters = { ...filters, work_group_fk: gappUser.work_group_fk };

      const { sql, params } = sqlListActive(scopedFilters);
      const { sql: countSql, params: countParams } = sqlCountActive(scopedFilters);
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
   * Só retorna o ativo se ele pertencer ao work_group_fk do usuário
   * autenticado — impede buscar por ID um ativo de outro grupo de trabalho.
   */
  async getById(id, currentUser) {
    let conn;
    try {
      conn = await poolGlobal.getConnection();
      const gappUser = await this._resolveGappUser(conn, currentUser);

      const [rows] = await conn.query(sqlGetActiveById(), [id, gappUser.work_group_fk]);
      if (!rows.length) throw new AppError('Ativo não encontrado', 404);

      const active = rows[0];
      if (active.is_vehicle === 1) {
        const [vehicleRows] = await conn.query(sqlGetVehicleByActiveId(), [id]);
        active.vehicle = vehicleRows[0] || null;
        if (active.vehicle) {
          const [insuranceRows] = await conn.query(sqlGetActiveInsuranceByVehicleId(), [active.vehicle.vehicle_id]);
          active.insurance = insuranceRows[0] || null;
        }
      }
      return active;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(error.message, 500);
    } finally {
      if (conn) conn.release();
    }
  }
}

module.exports = { GappActiveService };
