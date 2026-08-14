'use strict';

const { respond } = require('../../../utils/respond');
const { AppError } = require('../../../errors/app.error');
const { ShopUseCases } = require('../application/shop/shop.use-cases');
const { MysqlShopRepository } = require('../infrastructure/shop/mysql-shop.repository');
const { ProtheusShopSourceRepository } = require('../infrastructure/shop/protheus-shop-source.repository');
const { ConsincoShopSourceRepository } = require('../infrastructure/shop/consinco-shop-source.repository');

const useCases = new ShopUseCases({
    repository: new MysqlShopRepository(),
    externalSources: {
        protheus: new ProtheusShopSourceRepository(),
        consinco: new ConsincoShopSourceRepository(),
    },
});

/**
 * GET /shops
 * Query: ?company_id=X (opcional)
 */
async function getShops(req, res) {
    const data = await useCases.getShops(req.query.company_id ?? null);
    return respond.ok(res, data);
}

/**
 * GET /bppp/shops
 * Só lojas com código no Consinco — seletor do BPPP. Sem parâmetros.
 */
async function getShopsForBppp(req, res) {
    const data = await useCases.getShopsForBppp();
    return respond.ok(res, data);
}

/**
 * GET /shops/audit?source=protheus|consinco
 */
async function getShopsAudit(req, res) {
    const { source } = req.query;
    if (!source) throw new AppError('Parâmetro obrigatório: source (protheus | consinco)', 400);
    const data = await useCases.getAudit(source);
    return respond.ok(res, data);
}

module.exports = { getShops, getShopsForBppp, getShopsAudit };
