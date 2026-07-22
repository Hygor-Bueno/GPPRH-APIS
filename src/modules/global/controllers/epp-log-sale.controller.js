/**
 * @fileoverview Controller de Log de Vendas EPP.
 * @module modules/global/controllers/epp-log-sale.controller
 */

const { EppLogSaleService } = require('../services/epp-log-sale.service');
const { respond }           = require('../../../utils/respond');
const { AppError }          = require('../../../errors/app.error');

const service = new EppLogSaleService();

/**
 * GET /epp/log-sales
 * Query:
 *   - Sem params: lista todos
 *   - ?epp_id_order=X: itens de um pedido
 *   - ?controller=1: visão controller (JOINs) com filtros opcionais
 *   - ?mobile=1: visão mobile (agregada para produção)
 *   - ?oracle_receipe=1&seq_produto=X: receita Oracle de um produto
 */
async function getLogSales(req, res) {
    const { epp_id_order, controller, mobile, oracle_receipe, seq_produto } = req.query;

    if (oracle_receipe) {
        if (!seq_produto) throw new AppError('Parâmetro obrigatório: seq_produto', 400);
        const data = await service.getOracleReceipe(Number(seq_produto));
        return respond.ok(res, data);
    }

    if (mobile) {
        const { mobile: _, ...filters } = req.query;
        const data = await service.getMobileView(filters);
        return respond.ok(res, data);
    }

    if (controller) {
        // Passa todos os query params como filtros (exceto 'controller')
        const { controller: _, ...filters } = req.query;
        const data = await service.getControllerView(filters);
        return respond.ok(res, data);
    }

    if (epp_id_order) {
        const data = await service.getLogSalesByOrder(epp_id_order);
        return respond.ok(res, data);
    }

    const data = await service.getLogSales();
    respond.ok(res, data);
}

/**
 * POST /epp/log-sales
 * Body: { epp_id_order, epp_id_product, quantity, price, menu? }
 */
async function createLogSale(req, res) {
    const { epp_id_order, epp_id_product, quantity, price } = req.body;
    if (!epp_id_order || !epp_id_product || quantity == null || price == null) {
        throw new AppError('Campos obrigatórios: epp_id_order, epp_id_product, quantity, price', 400);
    }
    const data = await service.createLogSale(req.body);
    respond.created(res, data);
}

/**
 * PUT /epp/log-sales/:id
 * Body: { epp_id_order, epp_id_product, quantity, price, menu? }
 */
async function updateLogSale(req, res) {
    const { epp_id_order, epp_id_product, quantity, price } = req.body;
    if (!epp_id_order || !epp_id_product || quantity == null || price == null) {
        throw new AppError('Campos obrigatórios: epp_id_order, epp_id_product, quantity, price', 400);
    }
    const data = await service.updateLogSale(req.params.id, req.body);
    respond.ok(res, data);
}

/**
 * DELETE /epp/log-sales/:id
 */
async function deleteLogSaleById(req, res) {
    await service.deleteLogSaleById(req.params.id);
    respond.message(res, 'Item de venda excluído com sucesso');
}

/**
 * DELETE /epp/log-sales/order/:orderId
 */
async function deleteLogSaleByOrder(req, res) {
    const data = await service.deleteLogSaleByOrder(req.params.orderId);
    respond.ok(res, data);
}

module.exports = {
    getLogSales,
    createLogSale,
    updateLogSale,
    deleteLogSaleById,
    deleteLogSaleByOrder,
};
