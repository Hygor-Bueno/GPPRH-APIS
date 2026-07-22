/**
 * @fileoverview Controller de Estoque EPP.
 * @module modules/global/controllers/epp-stock.controller
 */

const { EppStockService } = require('../services/epp-stock.service');
const { respond }         = require('../../../utils/respond');
const { AppError }        = require('../../../errors/app.error');

const service = new EppStockService();

/**
 * GET /epp/stock
 * Query:
 *   - ?stock=1 [&id_product_fk=X]: estoque atual (com cálculo Oracle)
 *   - ?history=1&id_product_fk=X: histórico de movimentações
 *   - ?pending_production=1[&page=N]: produtos sem estoque (paginado)
 */
async function getStock(req, res) {
    const { stock, history, pending_production, id_product_fk, page } = req.query;

    if (history) {
        if (!id_product_fk) throw new AppError('Parâmetro obrigatório: id_product_fk', 400);
        const data = await service.getStockHistory(id_product_fk);
        return respond.ok(res, data);
    }

    if (pending_production) {
        const data = await service.getPendingProduction(page ?? 1);
        return respond.ok(res, data);
    }

    if (stock) {
        const data = await service.getStock(id_product_fk ?? null);
        return respond.ok(res, data);
    }

    throw new AppError('Parâmetro obrigatório: stock, history ou pending_production', 400);
}

/**
 * POST /epp/stock
 * Body: { id_product_fk, stock_quantity, created_by, updated_by, measure }
 *
 * stock_quantity positivo = entrada, negativo = saída.
 */
async function createStock(req, res) {
    const required = ['id_product_fk', 'stock_quantity', 'created_by', 'updated_by', 'measure'];
    const missing  = required.filter(f => req.body[f] == null || req.body[f] === '');
    if (missing.length) {
        throw new AppError(`Campos obrigatórios ausentes: ${missing.join(', ')}`, 400);
    }
    const data = await service.createStock(req.body);
    respond.created(res, data);
}

/**
 * PUT /epp/stock/:id
 * Body: { updated_by (obrigatório), + campos opcionais: id_product_fk, stock_quantity,
 *         status_stock, stock_delete, serie }
 *
 * Restrição: apenas administradores (verificado via middleware de permissão na rota).
 */
async function updateStock(req, res) {
    const { updated_by, ...fields } = req.body;
    if (!updated_by) throw new AppError('Campo obrigatório: updated_by', 400);

    const allFields = { ...fields, updated_by };
    const data = await service.updateStock(req.params.id, allFields);
    respond.ok(res, data);
}

module.exports = { getStock, createStock, updateStock };
