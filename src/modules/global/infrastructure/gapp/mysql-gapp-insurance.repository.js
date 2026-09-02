/**
 * @fileoverview Adapter MySQL — implementa `GappInsuranceRepositoryPort`.
 *
 * Traduz o SQLSTATE 45000 (erro de negócio sinalizado pela stored procedure
 * `sp_gapp_save_insurance`) para `AppError(msg, 400)`.
 *
 * @module modules/global/infrastructure/gapp/mysql-gapp-insurance.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { GappInsuranceRepositoryPort } = require('../../application/gapp/ports/gapp-insurance-repository.port');
const {
    sqlSaveInsurance, sqlSelectInsuranceIdOut, buildSaveInsuranceParams,
    sqlListInsurance, sqlCountInsurance, sqlGetInsuranceById,
    sqlGetActiveInsuranceByActiveId,
    sqlGetVehicleWorkGroupByVehicleId, sqlGetVehicleWorkGroupByInsuranceId,
} = require('../../repositories/mysql/gapp-insurance.queries');

class MysqlGappInsuranceRepository extends GappInsuranceRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.query(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GAPP_INSURANCE_MYSQL_ERROR',
                details: error
            });
        }
    }

    async saveInsurancePolicy(payload) {
        let conn;
        try {
            conn = await poolGlobal.getConnection();
            await conn.execute(sqlSaveInsurance(), buildSaveInsuranceParams(payload));
            const [[{ id }]] = await conn.query(sqlSelectInsuranceIdOut());
            return { id };
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
        const { sql, params } = sqlListInsurance(filters);
        const { sql: countSql, params: countParams } = sqlCountInsurance(filters);
        const [rows] = await this._query(sql, params);
        const [[{ total }]] = await this._query(countSql, countParams);
        return { items: rows, total, page: Number(filters.page) || 1, limit: Number(filters.limit) || 20 };
    }

    async getById(id, workGroupFk) {
        const [rows] = await this._query(sqlGetInsuranceById(), [id, workGroupFk]);
        return rows[0] ?? null;
    }

    async findVehicleWorkGroup(vehicleId) {
        const [rows] = await this._query(sqlGetVehicleWorkGroupByVehicleId(), [vehicleId]);
        return rows[0] ?? null;
    }

    async findInsuranceWorkGroup(idInsurance) {
        const [rows] = await this._query(sqlGetVehicleWorkGroupByInsuranceId(), [idInsurance]);
        return rows[0] ?? null;
    }

    async findActiveInsuranceByVehicleId(vehicleId) {
        const [rows] = await this._query(sqlGetActiveInsuranceByActiveId(), [vehicleId]);
        return rows[0] ?? null;
    }
}

module.exports = { MysqlGappInsuranceRepository };
