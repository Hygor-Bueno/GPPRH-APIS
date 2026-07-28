/**
 * @fileoverview Porta (contrato) de persistência MySQL para produtos EPP.
 *
 * @module modules/global/application/epp/product/ports/product-repository.port
 */

class ProductRepositoryPort {
    /** @returns {Promise<object[]>} Produtos ativos. */
    findProducts() { throw new Error('Not implemented'); }

    /** @returns {Promise<object[]>} Todos os produtos. */
    findProductsComplete() { throw new Error('Not implemented'); }

    /** @param {number} id */
    findProductById(id) { throw new Error('Not implemented'); }

    /** @returns {Promise<object[]>} */
    findCategories() { throw new Error('Not implemented'); }

    /** @param {object} filters */
    searchProducts(filters) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<boolean>} */
    productExists(id) { throw new Error('Not implemented'); }

    /** @param {object} fields */
    insertProduct(fields) { throw new Error('Not implemented'); }

    /**
     * @param {number} id
     * @param {object} fields
     * @returns {Promise<{updated: number}>}
     */
    updateProduct(id, fields) { throw new Error('Not implemented'); }

    /**
     * @param {number} id
     * @param {number} statusProd
     * @returns {Promise<{updated: number}>}
     */
    changeProductStatus(id, statusProd) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<boolean>} */
    hasOpenOrdersLinked(id) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<boolean>} */
    hasLinkedLogSale(id) { throw new Error('Not implemented'); }

    /** @param {number} id */
    deleteProduct(id) { throw new Error('Not implemented'); }
}

module.exports = { ProductRepositoryPort };
