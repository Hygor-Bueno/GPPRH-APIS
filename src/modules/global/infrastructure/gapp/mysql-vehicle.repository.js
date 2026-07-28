/**
 * @fileoverview Adapter MySQL — implementa `VehicleRepositoryPort`.
 *
 * @module modules/global/infrastructure/gapp/mysql-vehicle.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { VehicleRepositoryPort } = require('../../application/gapp/vehicle/ports/vehicle-repository.port');
const {
    sqlListVehicles, sqlCountVehicles, sqlGetVehicleById,
} = require('../../repositories/mysql/gapp-vehicle.queries');

class MysqlVehicleRepository extends VehicleRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.query(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GAPP_VEHICLE_MYSQL_ERROR',
                details: error
            });
        }
    }

    async list(filters) {
        const { sql, params } = sqlListVehicles(filters);
        const { sql: countSql, params: countParams } = sqlCountVehicles(filters);
        const [rows] = await this._query(sql, params);
        const [[{ total }]] = await this._query(countSql, countParams);
        return { items: rows, total, page: Number(filters.page) || 1, limit: Number(filters.limit) || 20 };
    }

    async findById(id, workGroupFk) {
        const [rows] = await this._query(sqlGetVehicleById(), [id, workGroupFk]);
        return rows[0] ?? null;
    }
}

module.exports = { MysqlVehicleRepository };
