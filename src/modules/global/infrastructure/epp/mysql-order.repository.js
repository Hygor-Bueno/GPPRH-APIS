/**
 * @fileoverview Adapter MySQL — implementa `OrderRepositoryPort`.
 *
 * `createOrderWithItems` encapsula a transação inteira (begin/commit/rollback)
 * dentro do adapter — o use-case só chama uma operação atômica, sem saber
 * que a persistência por trás é transacional. A tradução de
 * `ER_DUP_ENTRY`/`uq_consinco_order` para `AppError(409)` também é um
 * detalhe de driver MySQL, tratado aqui.
 *
 * @module modules/global/infrastructure/epp/mysql-order.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { OrderRepositoryPort } = require('../../application/epp/order/ports/order-repository.port');
const {
    SQL_GET_ORDERS_PENDING,
    sqlGetOrdersPendingByStore,
    SQL_GET_ORDER_BY_ID,
    SQL_GET_STORE_BY_USER,
    SQL_INSERT_ORDER,
    SQL_UPDATE_ORDER,
    SQL_DELIVER_ORDER,
    SQL_CANCEL_ORDER,
    SQL_CHECK_ORDER_HAS_LOG_SALES,
    SQL_DELETE_ORDER,
    SQL_INSERT_LOG_SALE,
    sqlGetProductsInfo,
} = require('../../repositories/mysql/epp.queries');

/** @param {import('../../domain/epp/order/order.entity').EppOrderEntity} entity */
function toInsertParams(entity) {
    return [
        entity.user_id, entity.storeName, entity.storeNumber, entity.name_client, entity.date_order,
        entity.delivery_date, entity.delivery_hour, entity.deliveryStoreName, entity.deliveryStoreNumber,
        entity.total, entity.fone, entity.email, entity.signal_value, entity.menu, entity.id_menu,
        entity.plu_menu, entity.type_rice, entity.description, entity.delivered, entity.dessert,
        entity.observation, entity.consinco_order_id,
    ];
}

/** @param {import('../../domain/epp/order/order.entity').EppOrderEntity} entity */
function toUpdateParams(entity, id) {
    return [
        entity.user_id, entity.storeName, entity.storeNumber, entity.name_client, entity.date_order,
        entity.delivery_date, entity.delivery_hour, entity.deliveryStoreName, entity.deliveryStoreNumber,
        entity.total, entity.fone, entity.email, entity.signal_value, entity.menu, entity.id_menu,
        entity.plu_menu, entity.type_rice, entity.description, entity.delivered, entity.dessert,
        entity.observation, id,
    ];
}

class MysqlOrderRepository extends OrderRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.query(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'EPP_ORDER_MYSQL_ERROR',
                details: error
            });
        }
    }

    async findOrdersPending() {
        const [rows] = await this._query(SQL_GET_ORDERS_PENDING);
        return rows;
    }

    async findOrdersPendingByStore(storeNumber) {
        const { sql, params } = sqlGetOrdersPendingByStore(storeNumber);
        const [rows] = await this._query(sql, params);
        return rows;
    }

    async findOrderById(id) {
        const [rows] = await this._query(SQL_GET_ORDER_BY_ID, [id]);
        return rows[0];
    }

    async getStoreByUser(userId) {
        const [rows] = await this._query(SQL_GET_STORE_BY_USER, [userId]);
        return rows[0] ?? null;
    }

    async insertOrder(entity) {
        const [result] = await this._query(SQL_INSERT_ORDER, toInsertParams(entity));
        return result;
    }

    async updateOrder(id, entity) {
        const [result] = await this._query(SQL_UPDATE_ORDER, toUpdateParams(entity, id));
        return { updated: result.affectedRows };
    }

    async changeOrderStatus(id, status) {
        const sql = status === 2 ? SQL_CANCEL_ORDER : SQL_DELIVER_ORDER;
        const [result] = await this._query(sql, [id]);
        return { updated: result.affectedRows };
    }

    async hasLinkedLogSales(id) {
        const [rows] = await this._query(SQL_CHECK_ORDER_HAS_LOG_SALES, [id]);
        return Boolean(rows[0]);
    }

    async deleteOrder(id) {
        await this._query(SQL_DELETE_ORDER, [id]);
    }

    async createOrderWithItems(entity, items) {
        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();

            const [orderResult] = await conn.query(SQL_INSERT_ORDER, toInsertParams(entity));
            const orderId = orderResult.insertId;
            const insertedItems = [];

            for (const item of items) {
                const [itemResult] = await conn.query(SQL_INSERT_LOG_SALE, [
                    orderId, item.epp_id_product, item.quantity, item.price, item.menu ?? 0
                ]);
                insertedItems.push({
                    epp_id_log: itemResult.insertId,
                    epp_id_order: orderId,
                    epp_id_product: item.epp_id_product,
                    quantity: item.quantity,
                    price: item.price,
                    menu: item.menu ?? 0,
                });
            }

            await conn.commit();

            const [[order]] = await conn.query(SQL_GET_ORDER_BY_ID, [orderId]);
            return { order, items: insertedItems };
        } catch (err) {
            await conn.rollback();
            if (err instanceof AppError) throw err;
            if (err.code === 'ER_DUP_ENTRY' && err.message.includes('uq_consinco_order')) {
                throw new AppError(`Pedido e-commerce ${entity.consinco_order_id} já foi confirmado.`, 409);
            }
            throw new AppError('Erro ao criar pedido com itens.', 500, { code: err.code, details: err });
        } finally {
            conn.release();
        }
    }

    async getProductsInfo(seqProdutos) {
        const { sql, params } = sqlGetProductsInfo(seqProdutos);
        const [rows] = await this._query(sql, params);
        return rows;
    }
}

module.exports = { MysqlOrderRepository };
