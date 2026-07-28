/**
 * @fileoverview Adapter MySQL — implementa `ProductRepositoryPort`.
 *
 * @module modules/global/infrastructure/epp/mysql-product.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { ProductRepositoryPort } = require('../../application/epp/product/ports/product-repository.port');
const {
    SQL_GET_PRODUCTS,
    SQL_GET_PRODUCTS_COMPLETE,
    SQL_GET_PRODUCT_BY_ID,
    SQL_GET_CATEGORIES,
    sqlSearchProducts,
    SQL_INSERT_PRODUCT,
    SQL_UPDATE_PRODUCT,
    SQL_CHANGE_PRODUCT_STATUS,
    SQL_CHECK_PRODUCT_OPEN_ORDERS,
    SQL_DELETE_PRODUCT,
    SQL_CHECK_PRODUCT_EXISTS,
    SQL_CHECK_PRODUCT_LINKED_LOG_SALE,
} = require('../../repositories/mysql/epp.queries');

class MysqlProductRepository extends ProductRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.query(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'EPP_PRODUCT_MYSQL_ERROR',
                details: error
            });
        }
    }

    async findProducts() {
        const [rows] = await this._query(SQL_GET_PRODUCTS);
        return rows;
    }

    async findProductsComplete() {
        const [rows] = await this._query(SQL_GET_PRODUCTS_COMPLETE);
        return rows;
    }

    async findProductById(id) {
        const [rows] = await this._query(SQL_GET_PRODUCT_BY_ID, [id]);
        return rows[0];
    }

    async findCategories() {
        const [rows] = await this._query(SQL_GET_CATEGORIES);
        return rows;
    }

    async searchProducts(filters) {
        const { sql, params } = sqlSearchProducts(filters);
        const [rows] = await this._query(sql, params);
        return rows;
    }

    async productExists(id) {
        const [rows] = await this._query(SQL_CHECK_PRODUCT_EXISTS, [id]);
        return Boolean(rows[0]);
    }

    async insertProduct({ id_product, description, price, status_prod, id_category_fk, measure }) {
        await this._query(SQL_INSERT_PRODUCT, [id_product, description, price, status_prod, id_category_fk, measure]);
    }

    async updateProduct(id, { description, price, status_prod, id_category_fk, measure }) {
        const [result] = await this._query(SQL_UPDATE_PRODUCT, [description, price, status_prod, id_category_fk, measure, id]);
        return { updated: result.affectedRows };
    }

    async changeProductStatus(id, statusProd) {
        const [result] = await this._query(SQL_CHANGE_PRODUCT_STATUS, [statusProd, id]);
        return { updated: result.affectedRows };
    }

    async hasOpenOrdersLinked(id) {
        const [rows] = await this._query(SQL_CHECK_PRODUCT_OPEN_ORDERS, [id]);
        return rows.length > 0;
    }

    async hasLinkedLogSale(id) {
        const [rows] = await this._query(SQL_CHECK_PRODUCT_LINKED_LOG_SALE, [id]);
        return Boolean(rows[0]);
    }

    async deleteProduct(id) {
        await this._query(SQL_DELETE_PRODUCT, [id]);
    }
}

module.exports = { MysqlProductRepository };
