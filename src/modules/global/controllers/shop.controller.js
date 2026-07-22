'use strict';

const { ShopService } = require('../services/shop.service');
const { respond }     = require('../../../utils/respond');
const { AppError }    = require('../../../errors/app.error');

const service = new ShopService();

/**
 * GET /shops
 * Query: ?company_id=X (opcional)
 */
async function getShops(req, res) {
    const data = await service.getShops(req.query.company_id ?? null);
    return respond.ok(res, data);
}

/**
 * GET /shops/audit?source=protheus|consinco
 */
async function getShopsAudit(req, res) {
    const { source } = req.query;
    if (!source) throw new AppError('Parâmetro obrigatório: source (protheus | consinco)', 400);
    const data = await service.getAudit(source);
    return respond.ok(res, data);
}

module.exports = { getShops, getShopsAudit };
