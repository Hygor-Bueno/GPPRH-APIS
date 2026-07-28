/**
 * @fileoverview Porta (contrato) de persistência MySQL para estoque EPP.
 *
 * @module modules/global/application/epp/stock/ports/stock-repository.port
 */

class StockRepositoryPort {
    /** @returns {Promise<object[]>} */
    findStock() { throw new Error('Not implemented'); }

    /** @param {number} idProduct */
    findStockByProduct(idProduct) { throw new Error('Not implemented'); }

    /** @param {number} idStock */
    findStockByIdStock(idStock) { throw new Error('Not implemented'); }

    /** @param {number} idProduct */
    findStockHistory(idProduct) { throw new Error('Not implemented'); }

    /** @returns {Promise<number>} */
    countPendingProduction() { throw new Error('Not implemented'); }

    /**
     * @param {number} offset
     * @param {number} limit
     */
    findPendingProduction(offset, limit) { throw new Error('Not implemented'); }

    /** @returns {Promise<object[]>} Menus com pedido pendente (independe de produto). */
    findMenusForStock() { throw new Error('Not implemented'); }

    /** @param {number} idStock @returns {Promise<boolean>} */
    stockExists(idStock) { throw new Error('Not implemented'); }

    /** @param {number} idStock */
    findStockRawById(idStock) { throw new Error('Not implemented'); }

    /** @param {object} fields */
    insertStock(fields) { throw new Error('Not implemented'); }

    /**
     * @param {number} idStock
     * @param {object} fields
     * @returns {Promise<{updated: number}>}
     */
    updateStock(idStock, fields) { throw new Error('Not implemented'); }
}

module.exports = { StockRepositoryPort };
