/**
 * @fileoverview Porta (contrato) de persistência MySQL para log de vendas EPP.
 *
 * @module modules/global/application/epp/log-sale/ports/log-sale-repository.port
 */

class LogSaleRepositoryPort {
    /** @returns {Promise<object[]>} */
    findLogSales() { throw new Error('Not implemented'); }

    /** @param {number} orderId */
    findLogSalesByOrder(orderId) { throw new Error('Not implemented'); }

    /** @param {object} filters */
    findControllerView(filters) { throw new Error('Not implemented'); }

    /** @returns {Promise<object[]>} Pedidos pendentes agregados por produto (sem filtro). */
    findReceipeEpp() { throw new Error('Not implemented'); }

    /** @param {object} filters */
    findReceipeEppFiltered(filters) { throw new Error('Not implemented'); }

    /** @param {number} orderId @returns {Promise<boolean>} */
    orderExists(orderId) { throw new Error('Not implemented'); }

    /** @param {object} fields */
    insertLogSale(fields) { throw new Error('Not implemented'); }

    /** @param {number} id */
    findLogSaleById(id) { throw new Error('Not implemented'); }

    /**
     * @param {number} id
     * @param {object} fields
     * @returns {Promise<{updated: number}>}
     */
    updateLogSale(id, fields) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<{deleted: number}>} */
    deleteLogSaleById(id) { throw new Error('Not implemented'); }

    /** @param {number} orderId @returns {Promise<{deleted: number}>} */
    deleteLogSaleByOrder(orderId) { throw new Error('Not implemented'); }
}

module.exports = { LogSaleRepositoryPort };
