/**
 * @fileoverview Controller de Pedidos EPP.
 * @module modules/global/controllers/epp-order.controller
 */

const { EppOrderUseCases } = require('../application/epp/order/order.use-cases');
const { MysqlOrderRepository } = require('../infrastructure/epp/mysql-order.repository');
const { OracleEppRepository } = require('../infrastructure/epp/oracle-epp.repository');
const { respond }         = require('../../../utils/respond');
const { AppError }        = require('../../../errors/app.error');

const useCases = new EppOrderUseCases({
    repository: new MysqlOrderRepository(),
    oracleRepository: new OracleEppRepository(),
});

/**
 * GET /epp/orders
 * Query: ?delivery_store=X (opcional)
 */
async function getOrders(req, res) {
    const data = await useCases.getOrders(req.query.delivery_store ?? null, req.user?.id ?? null);
    respond.ok(res, data);
}

/**
 * GET /epp/orders/:id
 */
async function getOrderById(req, res) {
    const data = await useCases.getOrderById(req.params.id);
    respond.ok(res, data);
}

/**
 * POST /epp/orders
 * Body: { user_id, store, name_client, date_order, delivery_date,
 *         delivery_hour, delivery_store, total, fone?, email?,
 *         signal_value?, menu?, id_menu?, plu_menu?, type_rice?,
 *         description?, dessert?, observation? }
 */
async function createOrder(req, res) {
    const required = ['name_client', 'date_order', 'delivery_date', 'delivery_hour', 'delivery_store', 'total'];
    const missing = required.filter(f => req.body[f] == null || req.body[f] === '');
    if (missing.length) {
        throw new AppError(`Campos obrigatórios ausentes: ${missing.join(', ')}`, 400);
    }
    const data = await useCases.createOrder({ ...req.body, user_id: req.user.id }, req.user.id);
    respond.created(res, data);
}

/**
 * PUT /epp/orders/:id
 * Body: mesmos campos do POST
 */
async function updateOrder(req, res) {
    const data = await useCases.updateOrder(req.params.id, { ...req.body, user_id: req.user.id }, req.user.id);
    respond.ok(res, data);
}

/**
 * PATCH /epp/orders/:id/status
 * Body: { delivered } — 1 = entregue, 2 = cancelado
 */
async function changeOrderStatus(req, res) {
    const { delivered } = req.body;
    if (delivered == null) throw new AppError('Campo obrigatório: delivered (1=entregue, 2=cancelado)', 400);
    const data = await useCases.changeOrderStatus(req.params.id, Number(delivered));
    respond.ok(res, data);
}

/**
 * DELETE /epp/orders/:id
 */
async function deleteOrder(req, res) {
    await useCases.deleteOrder(req.params.id);
    respond.message(res, 'Pedido excluído com sucesso');
}

/**
 * POST /epp/orders/bulk
 * Cria um pedido e seus itens de venda em uma única transação MySQL.
 * Body: { ...camposDoPedido, items: [{ epp_id_product, quantity, price, menu? }] }
 */
async function createOrderBulk(req, res) {
    const { items, ...orderPayload } = req.body;

    const required = ['name_client', 'date_order', 'delivery_date', 'delivery_hour', 'delivery_store', 'total'];
    const missing = required.filter(f => orderPayload[f] == null || orderPayload[f] === '');
    if (missing.length) {
        throw new AppError(`Campos obrigatórios ausentes: ${missing.join(', ')}`, 400);
    }

    const data = await useCases.createOrderWithItems({ ...orderPayload, user_id: req.user.id }, items, req.user.id);
    respond.created(res, data);
}

/**
 * GET /epp/orders/consinco/:nroPedido/ecommerce
 */
async function getEcommerceOrder(req, res) {
    const data = await useCases.getEcommerceOrder(Number(req.params.nroPedido));
    respond.ok(res, data);
}

/**
 * POST /epp/orders/consinco/:nroPedido/ecommerce
 * Body: { delivery_date, delivery_hour, delivery_store }
 */
async function confirmEcommerceOrder(req, res) {
    const { delivery_date, delivery_hour, delivery_store } = req.body;
    if (!delivery_date || !delivery_hour || !delivery_store) {
        throw new AppError('Campos obrigatórios: delivery_date, delivery_hour, delivery_store', 400);
    }
    const data = await useCases.confirmEcommerceOrder(
        Number(req.params.nroPedido),
        { delivery_date, delivery_hour, delivery_store },
        req.user.id
    );
    respond.created(res, data);
}

module.exports = {
    getOrders,
    getOrderById,
    createOrder,
    createOrderBulk,
    updateOrder,
    changeOrderStatus,
    deleteOrder,
    getEcommerceOrder,
    confirmEcommerceOrder,
};
