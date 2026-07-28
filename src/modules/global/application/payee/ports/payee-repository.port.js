/**
 * @fileoverview Porta (contrato) de persistência SQL Server — Payee.
 * @module modules/global/application/payee/ports/payee-repository.port
 */

class PayeeRepositoryPort {
    /** @param {object} filters @returns {Promise<object[]>} */
    findAll(filters) { throw new Error('Not implemented'); }

    /** @param {object} payload @returns {Promise<object>} */
    insert(payload) { throw new Error('Not implemented'); }

    /** @param {object} payload @returns {Promise<object|null>} */
    update(payload) { throw new Error('Not implemented'); }

    /** @param {number} id @param {object} fields @param {string} updatedBy @param {string} updatedByBranchCode @returns {Promise<object|null>} */
    patch(id, fields, updatedBy, updatedByBranchCode) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<boolean>} */
    exists(id) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<boolean>} se há recibos de pagamento ativos vinculados */
    hasActiveReceipts(id) { throw new Error('Not implemented'); }

    /** @param {number} id */
    remove(id) { throw new Error('Not implemented'); }
}

module.exports = { PayeeRepositoryPort };
