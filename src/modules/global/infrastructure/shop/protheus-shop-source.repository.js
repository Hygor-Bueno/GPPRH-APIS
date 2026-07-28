/**
 * @fileoverview Adapter SQL Server (Protheus) — implementa `ShopExternalSourceRepositoryPort`.
 * @module modules/global/infrastructure/shop/protheus-shop-source.repository
 */

const { poolPromise } = require('../../../../config/sqlserver');
const { AppError } = require('../../../../errors/app.error');
const { ShopExternalSourceRepositoryPort } = require('../../application/shop/ports/shop-external-source-repository.port');
const { normalizeCnpj } = require('../../domain/shop/shop-audit.shaper');
const { sqlGetProtheusShops } = require('../../repositories/sqlserver/shop.repository');

class ProtheusShopSourceRepository extends ShopExternalSourceRepositoryPort {
    async findAll() {
        try {
            const pool = await poolPromise;
            const result = await pool.request().query(sqlGetProtheusShops());
            return result.recordset.map(r => ({
                code: r.code?.trim(),
                description: r.description?.trim(),
                cnpj: normalizeCnpj(r.cnpj),
            }));
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o Protheus.', 500, {
                code: 'SHOP_PROTHEUS_ERROR',
                details: error,
            });
        }
    }
}

module.exports = { ProtheusShopSourceRepository };
