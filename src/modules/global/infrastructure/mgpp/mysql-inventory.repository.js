const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { MgppInventoryRepositoryPorts } = require("../../application/mgpp/inventory/ports/mgpp-inventory-repository-port")
const {
    sqlListInventory, sqlInsertInventory, sqlUpdateInventory,
    buildInsertInventory, buildUpdateInventory, 
    sqlGetConfigs, sqlGetNumberReleasesForMonth } = require('../../repositories/mysql/mgpp-inventory.queries')

class MysqlInventoryRepository {
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
        const [rows] = await this._query(sqlListInventory())
        return rows
    }
    async getConfigs(id) {
        const [rows] = await this._query(sqlGetConfigs(id));
        return rows[0]
    }
    async getNumberReleasesForMonth(date, id) {
        const [rows] = await this._query(sqlGetNumberReleasesForMonth(date, id))
        return rows[0].quantity
    }

    async create(data) {
        let conn = await poolGlobal.getConnection();
        try {
            const [result] = await conn.execute(sqlInsertInventory(), buildInsertInventory(data))
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
            const [result] = await conn.execute(sqlUpdateInventory(), buildUpdateInventory(data, id))
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
module.exports = { MysqlInventoryRepository }