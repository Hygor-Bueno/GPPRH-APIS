/**
 * @fileoverview Adapter MySQL — implementa `ActiveRepositoryPort`.
 *
 * Traduz o SQLSTATE 45000 (erro de negócio sinalizado pela stored procedure
 * `sp_gapp_save_active_v2`) para `AppError(msg, 400)`.
 *
 * @module modules/global/infrastructure/gapp/mysql-active.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { ActiveRepositoryPort } = require('../../application/gapp/active/ports/active-repository.port');
const {
    sqlSaveActive, sqlSelectActiveIdOut, buildSaveActiveParams,
    sqlListActive, sqlCountActive, sqlGetActiveById,
    sqlGetVehicleByActiveId, sqlGetIsVehicleByActiveId,
} = require('../../repositories/mysql/gapp-active.queries');

class MysqlActiveRepository extends ActiveRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            const req = await poolGlobal.query(sql, params);
            return req;
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GAPP_ACTIVE_MYSQL_ERROR',
                details: error
            });
        }
    }

    async findIsVehicleByActiveId(activeId, workGroupFk) {
        const [rows] = await this._query(sqlGetIsVehicleByActiveId(), [activeId, workGroupFk]);
        return rows[0] ?? null;
    }

    async saveActive(payload) {
        let conn;
        try {
            conn = await poolGlobal.getConnection();
            await conn.execute(sqlSaveActive(), buildSaveActiveParams(payload));
            const [[{ id, insurance_id }]] = await conn.query(sqlSelectActiveIdOut());
            return insurance_id != null ? { id, insurance_id } : { id };
        } catch (error) {
            if (error instanceof AppError) throw error;
            // SQLSTATE 45000 = erro de negócio sinalizado pela procedure → 400.
            const status = error.sqlState === '45000' ? 400 : 500;
            throw new AppError(error.sqlMessage || error.message, status);
        } finally {
            if (conn) conn.release();
        }
    }

    async list(filters) {
        const { sql, params } = sqlListActive(filters);
        const { sql: countSql, params: countParams } = sqlCountActive(filters);
        const [rows] = await this._query(sql, params);
        const [[{ total }]] = await this._query(countSql, countParams);
        return { items: rows, total, page: Number(filters.page) || 1, limit: Number(filters.limit) || 20 };
    }

    async findById(id, workGroupFk) {
        const [rows] = await this._query(sqlGetActiveById(), [id, workGroupFk]);
        return rows[0] ?? null;
    }

    async findVehicleByActiveId(activeId) {
        const [rows] = await this._query(sqlGetVehicleByActiveId(), [activeId]);
        return rows[0] ?? null;
    }
}

module.exports = { MysqlActiveRepository };
