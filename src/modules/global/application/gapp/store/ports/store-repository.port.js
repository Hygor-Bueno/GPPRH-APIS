/**
 * @fileoverview Porta (contrato) de persistência MySQL para lojas GAPP.
 *
 * @module modules/global/application/gapp/store/ports/store-repository.port
 */

class StoreRepositoryPort {
    /** @param {object} filters */
    list(filters) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<object|null>} */
    findById(id) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<boolean>} */
    storeExists(id) { throw new Error('Not implemented'); }

    /** @param {object} fields @returns {Promise<{insertId: number}>} */
    insert(fields) { throw new Error('Not implemented'); }

    /**
     * @param {number} id
     * @param {object} fields
     * @returns {Promise<{updated: number}>}
     */
    update(id, fields) { throw new Error('Not implemented'); }

    /** @param {number} id */
    softDeleteStore(id) { throw new Error('Not implemented'); }
}

module.exports = { StoreRepositoryPort };
