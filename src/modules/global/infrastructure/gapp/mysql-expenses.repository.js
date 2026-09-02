/**
 * @fileoverview Adapter MySQL — implementa `ExpensesRepositoryPort`.
 *
 * `createExpenseWithDetail`/`updateExpenseWithDetail` encapsulam a transação
 * inteira (begin/commit/rollback). O branch de tipo Seguro reaproveita as
 * SQL builders de `gapp-insurance.repository.js` diretamente (mesma `conn`
 * da transação de despesa) — reuso a nível de SQL cru, sem depender do
 * port/use-case de Insurance.
 *
 * @module modules/global/infrastructure/gapp/mysql-expenses.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { ExpensesRepositoryPort } = require('../../application/gapp/expenses/ports/expenses-repository.port');
const { ExpenseType } = require('../../domain/gapp/expenses/expense-type.enum');
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
    sqlGetExpenseById,
} = require('../../repositories/mysql/gapp-expenses.queries');
const {
    sqlSaveInsurance, sqlSelectInsuranceIdOut, buildSaveInsuranceParams,
} = require('../../repositories/mysql/gapp-insurance.queries');

class MysqlExpensesRepository extends ExpensesRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.query(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GAPP_EXPENSES_MYSQL_ERROR',
                details: error
            });
        }
    }

    async findActiveWorkGroup(activeId) {
        const [rows] = await this._query(sqlGetActiveWorkGroup(), [activeId]);
        return rows[0] ?? null;
    }

    async findExpenseType(id) {
        const [rows] = await this._query(sqlGetExpenseType(), [id]);
        return rows[0] ?? null;
    }

    async list(filters) {
        const { sql, params } = sqlListExpenses(filters);
        const { sql: countSql, params: countParams } = sqlCountExpenses(filters);
        const [rows] = await this._query(sql, params);
        const [[{ total }]] = await this._query(countSql, countParams);
        return { items: rows, total, page: Number(filters.page) || 1, limit: Number(filters.limit) || 20 };
    }

    async listVehicleExpenses(filters) {
        const { sql, params } = sqlListVehicleExpenses(filters);
        const { sql: countSql, params: countParams } = sqlCountVehicleExpenses(filters);
        const [rows] = await this._query(sql, params);
        const [[{ total }]] = await this._query(countSql, countParams);
        return { items: rows, total, page: Number(filters.page) || 1, limit: Number(filters.limit) || 50 };
    }

    async findExpenseById(id, workGroupFk) {
        const [rows] = await this._query(sqlGetExpenseById(), [id, workGroupFk]);
        return rows[0] ?? null;
    }

    async createExpenseWithDetail(expensePayload, expTypeId, detail, activeId) {
        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();

            const [result] = await conn.execute(sqlInsertExpense(), buildInsertExpenseParams(expensePayload));
            const expenId = result.insertId;

            await this._saveTypeDetail(conn, expTypeId, detail, expenId, activeId, false);

            await conn.commit();
            return { expen_id: expenId };
        } catch (err) {
            try { await conn.rollback(); } catch { /* conexão já pode ter caído */ }
            if (err instanceof AppError) throw err;
            throw new AppError(err.message, 500);
        } finally {
            conn.release();
        }
    }

    async updateExpenseWithDetail(id, expensePayload, expTypeId, detail, activeId) {
        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();

            await conn.execute(sqlUpdateExpense(), buildUpdateExpenseParams(expensePayload));
            await this._saveTypeDetail(conn, expTypeId, detail, id, activeId, true);

            await conn.commit();
            return { expen_id: id };
        } catch (err) {
            try { await conn.rollback(); } catch { /* conexão já pode ter caído */ }
            if (err instanceof AppError) throw err;
            throw new AppError(err.message, 500);
        } finally {
            conn.release();
        }
    }

    /**
     * Grava o detalhe específico do tipo dentro da mesma transação da
     * despesa. `detail == null` (tipo 6 — Outros) não grava nada.
     * @private
     */
    async _saveTypeDetail(conn, expTypeId, detail, expenId, activeId, isUpdate) {
        if (detail == null) return;

        switch (Number(expTypeId)) {
            case ExpenseType.FUEL:
                if (isUpdate) await conn.execute(sqlUpdateFuel(), buildUpdateFuelParams(detail, expenId));
                else await conn.execute(sqlInsertFuel(), buildInsertFuelParams(detail, expenId));
                return;
            case ExpenseType.MAINTENANCE:
                if (isUpdate) await conn.execute(sqlUpdateMaintenance(), buildUpdateMaintenanceParams(detail, expenId));
                else await conn.execute(sqlInsertMaintenance(), buildInsertMaintenanceParams(detail, expenId));
                return;
            case ExpenseType.SINISTER:
                if (isUpdate) await conn.execute(sqlUpdateSinister(), buildUpdateSinisterParams(detail, expenId));
                else await conn.execute(sqlInsertSinister(), buildInsertSinisterParams(detail, expenId));
                return;
            case ExpenseType.FINE:
                if (isUpdate) await conn.execute(sqlUpdateFine(), buildUpdateFineParams(detail, expenId));
                else await conn.execute(sqlInsertFine(), buildInsertFineParams(detail, expenId));
                return;
            case ExpenseType.INSURANCE:
                await this._saveInsuranceDetail(conn, detail, expenId, activeId, isUpdate);
                return;
            default:
                return;
        }
    }

    /**
     * Cria/atualiza a apólice de seguro vinculada à despesa, reaproveitando
     * a mesma `sp_gapp_save_insurance` usada nativamente por /gapp/insurance
     * — ela já desativa a apólice ativa anterior do veículo antes de criar
     * uma nova. `vehicle_id_fk` é resolvido do `active_id_fk` da despesa,
     * nunca do cliente. No update, a apólice já vinculada (se houver) é
     * atualizada in-place — nunca recriada, porque um sinistro pode
     * referenciá-la.
     * @private
     * @throws {AppError} 400 se não houver active_id_fk ou o ativo não for veículo.
     */
    async _saveInsuranceDetail(conn, detail, expenId, activeId, isUpdate) {
        if (activeId == null) {
            throw new AppError("Despesa do tipo Seguro exige 'active_id_fk' (usado pra resolver o veículo)", 400);
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
            active_id_fk: activeId
        };

        try {
            console.log(insurancePayload);
            await conn.execute(sqlSaveInsurance(), buildSaveInsuranceParams(insurancePayload));
        } catch (error) {
            // SQLSTATE 45000 = erro de negócio sinalizado pela procedure → 400.
            const status = error.sqlState === '45000' ? 400 : 500;
            throw new AppError(error.sqlMessage || error.message, status);
        }
        const [[{ id }]] = await conn.query(sqlSelectInsuranceIdOut());
        await conn.execute(sqlLinkInsuranceToExpense(), [expenId, id]);
    }
}

module.exports = { MysqlExpensesRepository };
