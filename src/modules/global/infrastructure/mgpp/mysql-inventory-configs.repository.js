const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { MgppInventoryConfigsRepositoryPorts } = require("../../../global/application/mgpp/inventory-configs/ports/mgpp-inventory-configs-repository-port")
const { sqlListInventoryConfigs, sqlInsertInventoryConfig, sqlUpdateInventoryConfig, buildInsertInventoryConfig, buildUpdateInventoryConfig } = require('../../repositories/mysql/mgpp-inventory-configs.queries')

class MysqlInventoryConfigsRepository {
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

    async list() {
        const [rows] = await this._query(sqlListInventoryConfigs())
        return rows
    }

    async create(data) {
        let conn = await poolGlobal.getConnection();
        try {
            const [result] = await conn.execute(sqlInsertInventoryConfig(), buildInsertInventoryConfig(data))
            return { insertId: result.insertId }
        } catch (error) {
            if (error instanceof AppError) throw error;
            const status = error.sqlState === '45000' ? 400 : 500;
            throw new AppError(error.sqlMessage || error.message, status);
        } finally {
            if (conn) conn.release();
        }
    }

    async update(id, data) {
        let conn = await poolGlobal.getConnection();
        try {
            const [result] = await conn.execute(sqlUpdateInventoryConfig(), buildUpdateInventoryConfig(data, id))
            return { id_uptaded: id }
        } catch (error) {
            if (error instanceof AppError) throw error;
            const status = error.sqlState === '45000' ? 400 : 500;
            throw new AppError(error.sqlMessage || error.message, status);
        } finally {
            if (conn) conn.release();
        }
    }
}
module.exports = { MysqlInventoryConfigsRepository }