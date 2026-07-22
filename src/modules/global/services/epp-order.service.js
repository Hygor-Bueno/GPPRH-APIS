/**
 * @fileoverview Serviço de Pedidos EPP.
 *
 * Gerencia CRUD de pedidos (epp_orders) com validação de datas.
 *
 * Regra de negócio de datas (replicada do PHP):
 *   - A data de entrega (delivery_date) deve estar entre:
 *     - Hoje − 15 dias (mínimo)
 *     - Último dia do mês corrente (máximo)
 *
 * @module modules/global/services/epp-order.service
 */

const { poolGlobal }   = require('../../../config/mysql');
const { AppError }     = require('../../../errors/app.error');
const { splitStore }   = require('../../../utils/store.util');
const { getEcommerceOrder } = require('../repositories/oracle/epp.oracle.repository');

const SQL_GET_STORE_BY_USER = `
    SELECT s.number, s.description AS name
    FROM global._user u
    INNER JOIN global._shop_codes sc_pro ON sc_pro.code = u.branch_code AND sc_pro.system_name = 'protheus'
    INNER JOIN global._shop       s      ON s.id = sc_pro.shop_id
    WHERE u.id = ?
`;
const {
    SQL_GET_ORDERS_PENDING,
    sqlGetOrdersPendingByStore,
    SQL_GET_ORDER_BY_ID,
    SQL_INSERT_ORDER,
    SQL_UPDATE_ORDER,
    SQL_DELIVER_ORDER,
    SQL_CANCEL_ORDER,
    SQL_DELETE_ORDER,
    SQL_INSERT_LOG_SALE,
    sqlGetProductsInfo,
} = require('../repositories/mysql/epp.repository');


class EppOrderService {

    // ─── Validação de Data ────────────────────────────────────────────────────

    /**
     * Valida que a data de entrega está dentro do range permitido.
     *
     * @param {string} deliveryDate - Formato YYYY-MM-DD
     * @throws {AppError} 422 se fora do range.
     */
    _validateDeliveryDate(deliveryDate) {
        const date = new Date(deliveryDate);
        if (isNaN(date.getTime())) {
            throw new AppError('Data de entrega inválida', 422);
        }

        const today     = new Date();
        today.setHours(0, 0, 0, 0);

        // Mínimo: 15 dias atrás
        const minDate = new Date(today);
        minDate.setDate(minDate.getDate() - 15);

        // Máximo: último dia do mês corrente
        const maxDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);

        if (date < minDate || date > maxDate) {
            throw new AppError(
                `Data de entrega fora do range permitido. ` +
                `Permitido: ${minDate.toISOString().slice(0, 10)} a ${maxDate.toISOString().slice(0, 10)}`,
                422
            );
        }
    }

    // ─── Consultas ────────────────────────────────────────────────────────────

    /**
     * Lista pedidos pendentes (delivered = 0).
     * @param {string|null} deliveryStore - Filtra por loja de entrega (opcional).
     */
    async getOrders(deliveryStore = null, userId = null) {
        let storeNumber = deliveryStore ? splitStore(deliveryStore).number : null;

        if (storeNumber == null && userId) {
            const [userStore] = await poolGlobal.query(SQL_GET_STORE_BY_USER, [userId]);
            storeNumber = userStore[0]?.number ?? null;
        }

        if (storeNumber != null) {
            const { sql, params } = sqlGetOrdersPendingByStore(storeNumber);
            const [rows] = await poolGlobal.query(sql, params);
            return rows;
        }

        const [rows] = await poolGlobal.query(SQL_GET_ORDERS_PENDING);
        return rows;
    }

    /**
     * Retorna um pedido pelo ID.
     * @throws {AppError} 404 se não encontrado.
     */
    async getOrderById(id) {
        const [rows] = await poolGlobal.query(SQL_GET_ORDER_BY_ID, [id]);
        if (!rows[0]) throw new AppError('Pedido não encontrado', 404);
        return rows[0];
    }

    // ─── Criação ──────────────────────────────────────────────────────────────

    async _getStoreByUser(userId) {
        const [rows] = await poolGlobal.query(SQL_GET_STORE_BY_USER, [userId]);
        if (!rows[0]) throw new AppError('Loja do usuário não encontrada', 404);
        return { name: rows[0].name.replace(/\s+/g, '-'), number: rows[0].number };
    }

    /**
     * Cria um novo pedido com validação de data.
     */
    async createOrder(payload, userId) {
        this._validateDeliveryDate(payload.delivery_date);

        const store         = await this._getStoreByUser(userId);
        const deliveryStore = splitStore(payload.delivery_store);

        const [result] = await poolGlobal.query(SQL_INSERT_ORDER, [
            payload.user_id,
            store.name,
            store.number,
            payload.name_client,
            payload.date_order,
            payload.delivery_date,
            payload.delivery_hour,
            deliveryStore.name,
            deliveryStore.number,
            payload.total,
            payload.fone             ?? null,
            payload.email            ?? null,
            payload.signal_value     ?? null,
            payload.menu             ?? null,
            payload.id_menu          ?? null,
            payload.plu_menu         ?? null,
            payload.type_rice        ?? null,
            payload.description      ?? null,
            payload.delivered        ?? 0,
            payload.dessert          ?? null,
            payload.observation ?? null,
            null,
        ]);
        return this.getOrderById(result.insertId);
    }

    // ─── Atualização ──────────────────────────────────────────────────────────

    /**
     * Atualiza completamente um pedido.
     * @throws {AppError} 404
     */
    async updateOrder(id, payload, userId) {
        const store         = await this._getStoreByUser(userId);
        const deliveryStore = splitStore(payload.delivery_store);

        const [result] = await poolGlobal.query(SQL_UPDATE_ORDER, [
            payload.user_id,
            store.name,
            store.number,
            payload.name_client,
            payload.date_order,
            payload.delivery_date,
            payload.delivery_hour,
            deliveryStore.name,
            deliveryStore.number,
            payload.total,
            payload.fone         ?? null,
            payload.email        ?? null,
            payload.signal_value ?? null,
            payload.menu         ?? null,
            payload.id_menu      ?? null,
            payload.plu_menu     ?? null,
            payload.type_rice    ?? null,
            payload.description  ?? null,
            payload.delivered    ?? 0,
            payload.dessert      ?? null,
            payload.observation  ?? null,
            id,
        ]);
        if (result.affectedRows === 0) throw new AppError('Pedido não encontrado', 404);
        return this.getOrderById(id);
    }

    /**
     * Altera o status de um pedido: entregue (1) ou cancelado (2).
     * @param {number} id
     * @param {1|2}    status - 1 = entregue, 2 = cancelado
     * @throws {AppError} 400 / 404
     */
    async changeOrderStatus(id, status) {
        if (status !== 1 && status !== 2) {
            throw new AppError('Status inválido. Use 1 (entregue) ou 2 (cancelado)', 400);
        }

        const sql = status === 2 ? SQL_CANCEL_ORDER : SQL_DELIVER_ORDER;
        const [result] = await poolGlobal.query(sql, [id]);
        if (result.affectedRows === 0) throw new AppError('Pedido não encontrado', 404);
        return { id_order: id, delivered: status };
    }

    // ─── Criação em lote (pedido + itens em uma transação) ───────────────────

    /**
     * Cria um pedido e seus itens de venda em uma única transação MySQL.
     * Se qualquer INSERT falhar, tudo é revertido.
     *
     * @param {object}   orderPayload  - Mesmos campos do createOrder
     * @param {object[]} items         - Array de { epp_id_product, quantity, price, menu? }
     * @returns {{ order: object, items: object[] }}
     */
    async createOrderWithItems(orderPayload, items, userId) {
        if (!Array.isArray(items) || items.length === 0) {
            throw new AppError('O pedido deve conter ao menos um item.', 400);
        }

        for (const [i, item] of items.entries()) {
            if (item.epp_id_product == null) throw new AppError(`Item[${i}]: campo obrigatório "epp_id_product".`, 400);
            if (item.quantity        == null) throw new AppError(`Item[${i}]: campo obrigatório "quantity".`, 400);
            if (item.price           == null) throw new AppError(`Item[${i}]: campo obrigatório "price".`, 400);
        }

        this._validateDeliveryDate(orderPayload.delivery_date);

        const store = await this._getStoreByUser(userId);

        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();

            const deliveryStore = splitStore(orderPayload.delivery_store);

            const [orderResult] = await conn.query(SQL_INSERT_ORDER, [
                orderPayload.user_id,
                store.name,
                store.number,
                orderPayload.name_client,
                orderPayload.date_order,
                orderPayload.delivery_date,
                orderPayload.delivery_hour,
                deliveryStore.name,
                deliveryStore.number,
                orderPayload.total,
                orderPayload.fone             ?? null,
                orderPayload.email            ?? null,
                orderPayload.signal_value     ?? null,
                orderPayload.menu             ?? null,
                orderPayload.id_menu          ?? null,
                orderPayload.plu_menu         ?? null,
                orderPayload.type_rice        ?? null,
                orderPayload.description      ?? null,
                orderPayload.delivered        ?? 0,
                orderPayload.dessert          ?? null,
                orderPayload.observation      ?? null,
                orderPayload.consinco_order_id ?? null,
            ]);

            const orderId      = orderResult.insertId;
            const insertedItems = [];

            for (const item of items) {
                const [itemResult] = await conn.query(SQL_INSERT_LOG_SALE, [
                    orderId,
                    item.epp_id_product,
                    item.quantity,
                    item.price,
                    item.menu ?? 0,
                ]);
                insertedItems.push({
                    epp_id_log:     itemResult.insertId,
                    epp_id_order:   orderId,
                    epp_id_product: item.epp_id_product,
                    quantity:       item.quantity,
                    price:          item.price,
                    menu:           item.menu ?? 0,
                });
            }

            await conn.commit();

            const [[order]] = await conn.query(SQL_GET_ORDER_BY_ID, [orderId]);
            return { order, items: insertedItems };

        } catch (err) {
            await conn.rollback();
            if (err instanceof AppError) throw err;
            if (err.code === 'ER_DUP_ENTRY' && err.message.includes('uq_consinco_order')) {
                throw new AppError(`Pedido e-commerce ${orderPayload.consinco_order_id} já foi confirmado.`, 409);
            }
            throw new AppError('Erro ao criar pedido com itens.', 500, err.code, err);
        } finally {
            conn.release();
        }
    }

    // ─── Atualização em lote (pedido + reposição de itens em uma transação) ──

    /**
     * Atualiza um pedido e redefine seus itens de venda em uma única transação:
     * 1. UPDATE epp_orders
     * 2. DELETE todos os epp_log_sale do pedido
     * 3. INSERT cada item do array
     *
     * @param {number}   id           - ID do pedido
     * @param {object}   orderPayload - Campos do pedido (mesmos do updateOrder)
     * @param {object[]} items        - Array de { epp_id_product, quantity, price, menu? }
     * @returns {{ order: object, items: object[] }}
     */
    async updateOrderWithItems(id, orderPayload, items) {
        if (!Array.isArray(items) || items.length === 0) {
            throw new AppError('O pedido deve conter ao menos um item.', 400);
        }

        for (const [i, item] of items.entries()) {
            if (item.epp_id_product == null) throw new AppError(`Item[${i}]: campo obrigatório "epp_id_product".`, 400);
            if (item.quantity        == null) throw new AppError(`Item[${i}]: campo obrigatório "quantity".`, 400);
            if (item.price           == null) throw new AppError(`Item[${i}]: campo obrigatório "price".`, 400);
        }

        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();

            const store         = splitStore(orderPayload.store);
            const deliveryStore = splitStore(orderPayload.delivery_store);

            const [updateResult] = await conn.query(SQL_UPDATE_ORDER, [
                orderPayload.user_id,
                store.name,
                store.number,
                orderPayload.name_client,
                orderPayload.date_order,
                orderPayload.delivery_date,
                orderPayload.delivery_hour,
                deliveryStore.name,
                deliveryStore.number,
                orderPayload.total,
                orderPayload.fone         ?? null,
                orderPayload.email        ?? null,
                orderPayload.signal_value ?? null,
                orderPayload.menu         ?? null,
                orderPayload.id_menu      ?? null,
                orderPayload.plu_menu     ?? null,
                orderPayload.type_rice    ?? null,
                orderPayload.description  ?? null,
                orderPayload.delivered    ?? 0,
                orderPayload.dessert      ?? null,
                orderPayload.observation  ?? null,
                id,
            ]);
            if (updateResult.affectedRows === 0) throw new AppError('Pedido não encontrado.', 404);

            await conn.query('DELETE FROM epp_log_sale WHERE epp_id_order = ?', [id]);

            const insertedItems = [];
            for (const item of items) {
                const [itemResult] = await conn.query(SQL_INSERT_LOG_SALE, [
                    id,
                    item.epp_id_product,
                    item.quantity,
                    item.price,
                    item.menu ?? 0,
                ]);
                insertedItems.push({
                    epp_id_log:     itemResult.insertId,
                    epp_id_order:   id,
                    epp_id_product: item.epp_id_product,
                    quantity:       item.quantity,
                    price:          item.price,
                    menu:           item.menu ?? 0,
                });
            }

            await conn.commit();

            const [[order]] = await conn.query(SQL_GET_ORDER_BY_ID, [id]);
            return { order, items: insertedItems };

        } catch (err) {
            await conn.rollback();
            if (err instanceof AppError) throw err;
            throw new AppError('Erro ao atualizar pedido com itens.', 500, err.code, err);
        } finally {
            conn.release();
        }
    }

    // ─── Exclusão ─────────────────────────────────────────────────────────────

    /**
     * Remove um pedido. Bloqueia se houver itens de venda vinculados.
     * @throws {AppError} 404 / 409
     */
    async deleteOrder(id) {
        const [existing] = await poolGlobal.query(SQL_GET_ORDER_BY_ID, [id]);
        if (!existing[0]) throw new AppError('Pedido não encontrado', 404);

        const [linked] = await poolGlobal.query(
            'SELECT epp_id_log FROM epp_log_sale WHERE epp_id_order = ? LIMIT 1', [id]
        );
        if (linked[0]) throw new AppError('Pedido possui itens de venda vinculados. Exclua os itens antes.', 409);

        await poolGlobal.query(SQL_DELETE_ORDER, [id]);
        return { deleted: true };
    }

    // ─── Ecommerce (Consinco) ─────────────────────────────────────────────────

    async _fetchEcommerceItems(nroPedido) {
        const rows = await getEcommerceOrder(nroPedido);
        if (!rows || rows.length === 0) throw new AppError(`Pedido ${nroPedido} não encontrado na Consinco.`, 404);

        const first = rows[0];
        const header = {
            order_number: first.NROPEDIDOAFV,
            date:         first.DTAINCLUSAO instanceof Date
                ? first.DTAINCLUSAO.toISOString().slice(0, 10)
                : String(first.DTAINCLUSAO).slice(0, 10),
            user:         first.USUINCLUSAO,
            client_code:  first.COD_CLIENTE,
            client_name:  first.NOME_CLIENTE,
            phone:        first.FONENRO1 ?? null,
            email:        first.EMAIL    ?? null,
            total:        rows.reduce((sum, r) => sum + Number(r.VALOR_CONSINCO), 0),
        };

        const seqProdutos = rows.map(r => String(r.SEQPRODUTO));
        const { sql, params } = sqlGetProductsInfo(seqProdutos);
        const [mysqlRows] = await poolGlobal.query(sql, params);
        const productMap = new Map(mysqlRows.map(p => [String(p.id_product), p.is_menu]));

        const items = rows.map(r => {
            const seq = String(r.SEQPRODUTO);
            const registered = productMap.has(seq);
            return {
                product_id:  r.SEQPRODUTO,
                description: r.DESCRICAO,
                quantity:    Number(r.QUANTIDADE),
                unit_price:  Number(r.VALOR_UN_CONSINCO),
                total:       Number(r.VALOR_CONSINCO),
                registered,
                is_menu:     registered ? productMap.get(seq) : 0,
            };
        });

        return { header, items };
    }

    async getEcommerceOrder(nroPedido) {
        return this._fetchEcommerceItems(nroPedido);
    }

    async confirmEcommerceOrder(nroPedido, payload, userId) {
        const { header, items } = await this._fetchEcommerceItems(nroPedido);

        const registered   = items.filter(i => i.registered);
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
            user_id:           userId,
            name_client:       nameClient,
            date_order:        header.date,
            delivery_date:     payload.delivery_date,
            delivery_hour:     payload.delivery_hour,
            delivery_store:    payload.delivery_store,
            total:             Math.round(total * 100) / 100,
            fone:              header.phone ?? null,
            email:             header.email ?? null,
            description,
            observation:       `Pedido E-commerce: ${nroPedido}`,
            consinco_order_id: nroPedido,
        };

        const orderItems = registered.map(i => ({
            epp_id_product: i.product_id,
            quantity:       i.quantity,
            price:          i.unit_price,
            menu:           i.is_menu,
        }));

        const result = await this.createOrderWithItems(orderPayload, orderItems, userId);

        const warnings = unregistered.map(i => ({
            product_id:  i.product_id,
            description: i.description,
            reason:      'Product not registered in the system',
        }));

        return {
            partial:  warnings.length > 0,
            order:    result.order,
            items:    result.items,
            warnings,
        };
    }
}

module.exports = { EppOrderService };
