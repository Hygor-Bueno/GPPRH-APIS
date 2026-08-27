/**
 * @fileoverview Adapter MySQL — implementa `ShopRepositoryPort`.
 * @module modules/global/infrastructure/shop/mysql-shop.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { ShopRepositoryPort } = require('../../application/shop/ports/shop-repository.port');
const {
    SQL_GET_SHOPS,
    SQL_GET_SHOPS_BY_COMPANY,
    SQL_GET_SHOPS_CONSINCO,
    SQL_GET_SHOPS_WITH_CODES,
} = require('../../repositories/mysql/shop.queries');

class MysqlShopRepository extends ShopRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.query(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'SHOP_MYSQL_ERROR',
                details: error,
            });
        }
    }

    async findAll(companyId) {
        const [rows] = companyId
            ? await this._query(SQL_GET_SHOPS_BY_COMPANY, [companyId])
            : await this._query(SQL_GET_SHOPS);
        return rows;
    }

    async findAllFromConsinco() {
        const [rows] = await this._query(SQL_GET_SHOPS_CONSINCO);
        return rows;
    }

    async findAllWithCodes() {
        const [rows] = await this._query(SQL_GET_SHOPS_WITH_CODES);
        return rows;
    }
}

module.exports = { MysqlShopRepository };
