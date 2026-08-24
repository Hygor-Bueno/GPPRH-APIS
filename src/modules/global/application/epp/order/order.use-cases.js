/**
 * @fileoverview Casos de uso — Pedidos EPP.
 *
 * Orquestra a porta MySQL (CRUD + transação atômica de itens) e a porta
 * Oracle compartilhada (fluxo e-commerce Consinco). Não inclui
 * `updateOrderWithItems` (método morto removido nesta migração — nenhuma
 * rota o chamava).
 *
 * @module modules/global/application/epp/order/order.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { splitStore } = require('../../../../../utils/store.util');
const { EppOrderEntity } = require('../../../domain/epp/order/order.entity');
const { validateOrderItems } = require('../../../domain/epp/order/order-items.validator');

class EppOrderUseCases {
    /**
     * @param {Object} deps
     * @param {import('./ports/order-repository.port').OrderRepositoryPort} deps.repository
     * @param {import('../ports/oracle-epp-repository.port').OracleEppRepositoryPort} deps.oracleRepository
     */
    constructor({ repository, oracleRepository }) {
        this.repository = repository;
        this.oracleRepository = oracleRepository;
    }

    // ─── Consultas ────────────────────────────────────────────────────────────

    async getOrders(deliveryStore = null, userId = null) {
        let storeNumber = deliveryStore ? splitStore(deliveryStore).number : null;

        if (storeNumber == null && userId) {
            const userStore = await this.repository.getStoreByUser(userId);
            storeNumber = userStore?.number ?? null;
        }

        if (storeNumber != null) {
            return this.repository.findOrdersPendingByStore(storeNumber);
        }

        return this.repository.findOrdersPending();
    }

    async getOrderById(id) {
        const order = await this.repository.findOrderById(id);
        if (!order) throw new AppError('Pedido não encontrado', 404);
        return order;
    }

    // ─── Criação ──────────────────────────────────────────────────────────────

    async _getStoreByUser(userId) {
        const row = await this.repository.getStoreByUser(userId);
        if (!row) throw new AppError('Loja do usuário não encontrada', 404);
        return { name: row.name.replace(/\s+/g, '-'), number: row.number };
    }

    async createOrder(payload, userId) {
        const store = await this._getStoreByUser(userId);
        const entity = new EppOrderEntity({ payload, store });

        const result = await this.repository.insertOrder(entity);
        return this.getOrderById(result.insertId);
    }

    // ─── Atualização ──────────────────────────────────────────────────────────

    async updateOrder(id, payload, userId) {
        const store = await this._getStoreByUser(userId);
        const entity = new EppOrderEntity({ payload, store });

        const { updated } = await this.repository.updateOrder(id, entity);
        if (updated === 0) throw new AppError('Pedido não encontrado', 404);
        return this.getOrderById(id);
    }

    async changeOrderStatus(id, status) {
        if (status !== 1 && status !== 2) {
            throw new AppError('Status inválido. Use 1 (entregue) ou 2 (cancelado)', 400);
        }

        const { updated } = await this.repository.changeOrderStatus(id, status);
        if (updated === 0) throw new AppError('Pedido não encontrado', 404);
        return { id_order: id, delivered: status };
    }

    // ─── Criação em lote (pedido + itens em uma transação) ───────────────────

    async createOrderWithItems(orderPayload, items, userId) {
        validateOrderItems(items);

        const store = await this._getStoreByUser(userId);
        const entity = new EppOrderEntity({ payload: orderPayload, store });

        return this.repository.createOrderWithItems(entity, items);
    }

    // ─── Exclusão ─────────────────────────────────────────────────────────────

    async deleteOrder(id) {
        const existing = await this.repository.findOrderById(id);
        if (!existing) throw new AppError('Pedido não encontrado', 404);

        const linked = await this.repository.hasLinkedLogSales(id);
        if (linked) throw new AppError('Pedido possui itens de venda vinculados. Exclua os itens antes.', 409);

        await this.repository.deleteOrder(id);
        return { deleted: true };
    }

    // ─── Ecommerce (Consinco) ─────────────────────────────────────────────────

    async _fetchEcommerceItems(nroPedido) {
        const rows = await this.oracleRepository.getEcommerceOrder(nroPedido);
        if (!rows || rows.length === 0) throw new AppError(`Pedido ${nroPedido} não encontrado na Consinco.`, 404);

        const first = rows[0];
        const header = {
            order_number: first.NROPEDIDOAFV,
            date: first.DTAINCLUSAO instanceof Date
                ? first.DTAINCLUSAO.toISOString().slice(0, 10)
                : String(first.DTAINCLUSAO).slice(0, 10),
            user: first.USUINCLUSAO,
            client_code: first.COD_CLIENTE,
            client_name: first.NOME_CLIENTE,
            phone: first.FONENRO1 ?? null,
            email: first.EMAIL ?? null,
            total: rows.reduce((sum, r) => sum + Number(r.VALOR_CONSINCO), 0),
        };

        const seqProdutos = rows.map(r => String(r.SEQPRODUTO));
        const mysqlRows = await this.repository.getProductsInfo(seqProdutos);
        const productMap = new Map(mysqlRows.map(p => [String(p.id_product), p.is_menu]));

        const items = rows.map(r => {
            const seq = String(r.SEQPRODUTO);
            const registered = productMap.has(seq);
            return {
                product_id: r.SEQPRODUTO,
                description: r.DESCRICAO,
                quantity: Number(r.QUANTIDADE),
                unit_price: Number(r.VALOR_UN_CONSINCO),
                total: Number(r.VALOR_CONSINCO),
                registered,
                is_menu: registered ? productMap.get(seq) : 0,
            };
        });

        return { header, items };
    }

    async getEcommerceOrder(nroPedido) {
        return this._fetchEcommerceItems(nroPedido);
    }

    async confirmEcommerceOrder(nroPedido, payload, userId) {
        const { header, items } = await this._fetchEcommerceItems(nroPedido);

        const registered = items.filter(i => i.registered);
        const unregistered = items.filter(i => !i.registered);

        if (registered.length === 0) {
            throw new AppError('Nenhum item do pedido está cadastrado no sistema.', 422);
        }

        const description = registered.map(i =>
            `Cod: ${i.product_id}    \nDescrição: ${i.description}    \nUn: (Preço Un R$${i.unit_price.toFixed(2)})    \nSubtotal: R$${i.total.toFixed(2)} \n\n`
        ).join('');

        const total = registered.reduce((sum, i) => sum + i.total, 0);

        const nameClient = header.client_name
            .toLowerCase()
            .replace(/\b\w/g, c => c.toUpperCase());

        const orderPayload = {
            user_id: userId,
            name_client: nameClient,
            date_order: header.date,
            delivery_date: payload.delivery_date,
            delivery_hour: payload.delivery_hour,
            delivery_store: payload.delivery_store,
            total: Math.round(total * 100) / 100,
            fone: header.phone ?? null,
            email: header.email ?? null,
            description,
            observation: `Pedido E-commerce: ${nroPedido}`,
            consinco_order_id: nroPedido,
        };

        const orderItems = registered.map(i => ({
            epp_id_product: i.product_id,
            quantity: i.quantity,
            price: i.unit_price,
            menu: i.is_menu,
        }));

        const result = await this.createOrderWithItems(orderPayload, orderItems, userId);

        const warnings = unregistered.map(i => ({
            product_id: i.product_id,
            description: i.description,
            reason: 'Product not registered in the system',
        }));

        return {
            partial: warnings.length > 0,
            order: result.order,
            items: result.items,
            warnings,
        };
    }
}

module.exports = { EppOrderUseCases };
