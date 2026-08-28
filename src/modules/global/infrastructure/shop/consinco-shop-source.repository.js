/**
 * @fileoverview Adapter Oracle (Consinco) — implementa `ShopExternalSourceRepositoryPort`.
 * @module modules/global/infrastructure/shop/consinco-shop-source.repository
 */

const { oracleQuery } = require('../../../../config/oracle');
const { AppError } = require('../../../../errors/app.error');
const { ShopExternalSourceRepositoryPort } = require('../../application/shop/ports/shop-external-source-repository.port');
const { normalizeCnpj } = require('../../domain/shop/shop-audit.shaper');
const { sqlGetConsincoShops } = require('../../repositories/oracle/shop.queries');

class ConsincoShopSourceRepository extends ShopExternalSourceRepositoryPort {
    async findAll() {
        try {
            const rows = await oracleQuery(sqlGetConsincoShops());
            return rows.map(r => ({
                code: String(r.CODE),
                description: r.DESCRIPTION,
                cnpj: normalizeCnpj(r.CNPJ),
            }));
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o Consinco.', 500, {
                code: 'SHOP_CONSINCO_ERROR',
                details: error,
            });
        }
    }
}

module.exports = { ConsincoShopSourceRepository };
