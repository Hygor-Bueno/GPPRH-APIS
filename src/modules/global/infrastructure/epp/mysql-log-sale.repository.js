/**
 * @fileoverview Adapter MySQL — implementa `LogSaleRepositoryPort`.
 *
 * @module modules/global/infrastructure/epp/mysql-log-sale.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { LogSaleRepositoryPort } = require('../../application/epp/log-sale/ports/log-sale-repository.port');
const {
    SQL_GET_LOG_SALES_ALL,
    SQL_GET_LOG_SALES_BY_ORDER,
    sqlGetControllerView,
    SQL_GET_RECEIPE_EPP,
    sqlGetReceipeEppFiltered,
    SQL_INSERT_LOG_SALE,
    SQL_UPDATE_LOG_SALE,
    SQL_DELETE_LOG_SALE_BY_ID,
    SQL_DELETE_LOG_SALE_BY_ORDER,
    SQL_CHECK_ORDER_EXISTS,
    SQL_GET_LOG_SALE_BY_ID,
} = require('../../repositories/mysql/epp.queries');

class MysqlLogSaleRepository extends LogSaleRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.query(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'EPP_LOG_SALE_MYSQL_ERROR',
                details: error
            });
        }
    }

    async findLogSales() {
        const [rows] = await this._query(SQL_GET_LOG_SALES_ALL);
        return rows;
    }

    async findLogSalesByOrder(orderId) {
        const [rows] = await this._query(SQL_GET_LOG_SALES_BY_ORDER, [orderId]);
        return rows;
    }

    async findControllerView(filters) {
        const { sql, params } = sqlGetControllerView(filters);
        const [rows] = await this._query(sql, params);
        return rows;
    }

    async findReceipeEpp() {
        const [rows] = await this._query(SQL_GET_RECEIPE_EPP);
        return rows;
    }

    async findReceipeEppFiltered(filters) {
        const { sql, params } = sqlGetReceipeEppFiltered(filters);
        const [rows] = await this._query(sql, params);
        return rows;
    }

    async orderExists(orderId) {
        const [rows] = await this._query(SQL_CHECK_ORDER_EXISTS, [orderId]);
        return Boolean(rows[0]);
    }

    async insertLogSale({ epp_id_order, epp_id_product, quantity, price, menu }) {
        const [result] = await this._query(SQL_INSERT_LOG_SALE, [epp_id_order, epp_id_product, quantity, price, menu]);
        return result;
    }

    async findLogSaleById(id) {
        const [rows] = await this._query(SQL_GET_LOG_SALE_BY_ID, [id]);
        return rows[0];
    }

    async updateLogSale(id, { epp_id_order, epp_id_product, quantity, price, menu }) {
        const [result] = await this._query(SQL_UPDATE_LOG_SALE, [epp_id_order, epp_id_product, quantity, price, menu, id]);
        return { updated: result.affectedRows };
    }

    async deleteLogSaleById(id) {
        const [result] = await this._query(SQL_DELETE_LOG_SALE_BY_ID, [id]);
        return { deleted: result.affectedRows };
    }

    async deleteLogSaleByOrder(orderId) {
        const [result] = await this._query(SQL_DELETE_LOG_SALE_BY_ORDER, [orderId]);
        return { deleted: result.affectedRows };
    }
}

module.exports = { MysqlLogSaleRepository };
