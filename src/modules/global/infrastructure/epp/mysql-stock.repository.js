/**
 * @fileoverview Adapter MySQL — implementa `StockRepositoryPort`.
 *
 * @module modules/global/infrastructure/epp/mysql-stock.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { StockRepositoryPort } = require('../../application/epp/stock/ports/stock-repository.port');
const {
    SQL_GET_STOCK,
    SQL_GET_STOCK_BY_PRODUCT,
    SQL_GET_STOCK_BY_ID_STOCK,
    SQL_GET_STOCK_HISTORY,
    SQL_GET_PENDING_PRODUCTION,
    SQL_COUNT_PENDING_PRODUCTION,
    SQL_GET_MENUS_FOR_STOCK,
    SQL_INSERT_STOCK,
    sqlUpdateStock,
    SQL_CHECK_STOCK_EXISTS,
    SQL_GET_STOCK_RAW_BY_ID,
} = require('../../repositories/mysql/epp.queries');

class MysqlStockRepository extends StockRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.query(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'EPP_STOCK_MYSQL_ERROR',
                details: error
            });
        }
    }

    async findStock() {
        const [rows] = await this._query(SQL_GET_STOCK);
        return rows;
    }

    async findStockByProduct(idProduct) {
        const [rows] = await this._query(SQL_GET_STOCK_BY_PRODUCT, [idProduct]);
        return rows;
    }

    async findStockByIdStock(idStock) {
        const [rows] = await this._query(SQL_GET_STOCK_BY_ID_STOCK, [idStock]);
        return rows;
    }

    async findStockHistory(idProduct) {
        const [rows] = await this._query(SQL_GET_STOCK_HISTORY, [idProduct]);
        return rows;
    }

    async countPendingProduction() {
        const [[countRow]] = await this._query(SQL_COUNT_PENDING_PRODUCTION);
        return parseInt(countRow.total, 10);
    }

    async findPendingProduction(offset, limit) {
        const [rows] = await this._query(SQL_GET_PENDING_PRODUCTION, [offset, limit]);
        return rows;
    }

    async findMenusForStock() {
        const [rows] = await this._query(SQL_GET_MENUS_FOR_STOCK);
        return rows;
    }

    async stockExists(idStock) {
        const [rows] = await this._query(SQL_CHECK_STOCK_EXISTS, [idStock]);
        return Boolean(rows[0]);
    }

    async findStockRawById(idStock) {
        const [rows] = await this._query(SQL_GET_STOCK_RAW_BY_ID, [idStock]);
        return rows[0];
    }

    async insertStock({ id_product_fk, stock_quantity, created_by, updated_by }) {
        const [result] = await this._query(SQL_INSERT_STOCK, [id_product_fk, stock_quantity, created_by, updated_by]);
        return result;
    }

    async updateStock(idStock, fields) {
        const { sql, params } = sqlUpdateStock(idStock, fields);
        const [result] = await this._query(sql, params);
        return { updated: result.affectedRows };
    }
}

module.exports = { MysqlStockRepository };
