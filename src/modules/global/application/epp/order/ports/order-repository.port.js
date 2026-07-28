/**
 * @fileoverview Porta (contrato) de persistência MySQL para pedidos EPP.
 *
 * Inclui `createOrderWithItems` como operação atômica única — a transação
 * (begin/commit/rollback) fica inteiramente encapsulada no adapter, o
 * use-case não sabe que a persistência por trás é transacional.
 *
 * @module modules/global/application/epp/order/ports/order-repository.port
 */

class OrderRepositoryPort {
    /** @returns {Promise<object[]>} */
    findOrdersPending() { throw new Error('Not implemented'); }

    /** @param {number} storeNumber */
    findOrdersPendingByStore(storeNumber) { throw new Error('Not implemented'); }

    /** @param {number} id */
    findOrderById(id) { throw new Error('Not implemented'); }

    /** @param {number} userId @returns {Promise<{number, name}|null>} */
    getStoreByUser(userId) { throw new Error('Not implemented'); }

    /** @param {import('../../../../domain/epp/order/order.entity').EppOrderEntity} entity */
    insertOrder(entity) { throw new Error('Not implemented'); }

    /**
     * @param {number} id
     * @param {import('../../../../domain/epp/order/order.entity').EppOrderEntity} entity
     * @returns {Promise<{updated: number}>}
     */
    updateOrder(id, entity) { throw new Error('Not implemented'); }

    /**
     * @param {number} id
     * @param {1|2} status
     * @returns {Promise<{updated: number}>}
     */
    changeOrderStatus(id, status) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<boolean>} */
    hasLinkedLogSales(id) { throw new Error('Not implemented'); }

    /** @param {number} id */
    deleteOrder(id) { throw new Error('Not implemented'); }

    /**
     * Insere o pedido e todos os itens numa única transação atômica.
     * @param {import('../../../../domain/epp/order/order.entity').EppOrderEntity} entity
     * @param {object[]} items
     * @returns {Promise<{order: object, items: object[]}>}
     */
    createOrderWithItems(entity, items) { throw new Error('Not implemented'); }

    /** @param {string[]} seqProdutos @returns {Promise<object[]>} */
    getProductsInfo(seqProdutos) { throw new Error('Not implemented'); }
}

module.exports = { OrderRepositoryPort };
