/**
 * @fileoverview Porta (contrato) de persistência SQL Server — GIPP-RH.
 * @module modules/global/application/gipp-rh/ports/gipp-rh-repository.port
 */

class GippRhRepositoryPort {
    // ─── Compensações ───────────────────────────────────────────────────────
    findActiveCompensations() { throw new Error('Not implemented'); }

    /** @param {object} payload @returns {Promise<object>} */
    insertCompensation(payload) { throw new Error('Not implemented'); }

    /** @param {object} payload @returns {Promise<object>} */
    updateCompensation(payload) { throw new Error('Not implemented'); }

    // ─── Beneficiários ──────────────────────────────────────────────────────
    findActiveBeneficiaries() { throw new Error('Not implemented'); }

    /**
     * Insere ou atualiza um beneficiário via `sp_gipp_insert_employee_compensation`
     * (a mesma procedure decide insert/update com base na presença de `payload.id`).
     * @param {object} payload
     * @returns {Promise<object>}
     */
    upsertBeneficiary(payload) { throw new Error('Not implemented'); }

    // ─── Colaboradores ──────────────────────────────────────────────────────
    /** @param {object} filters @returns {Promise<object[]>} */
    findEmployeesPaginated(filters) { throw new Error('Not implemented'); }

    // ─── Recibos — PDF ──────────────────────────────────────────────────────
    /**
     * @param {?string} employeeCode @param {string} branchCode
     * @param {string} referenceInit @param {string} referenceEnd @param {?number} payeeId
     * @returns {Promise<object[]>}
     */
    findReceiptData(employeeCode, branchCode, referenceInit, referenceEnd, payeeId) { throw new Error('Not implemented'); }

    /** @param {string[]} groupIds @returns {Promise<object[]>} */
    findReceiptsByGroupIds(groupIds) { throw new Error('Not implemented'); }

    // ─── Códigos de evento / Tipos de pagamento ────────────────────────────
    findEventCodes() { throw new Error('Not implemented'); }
    findPaymentTypes() { throw new Error('Not implemented'); }

    // ─── Recibos de pagamento — CRUD ────────────────────────────────────────
    /**
     * @param {object} payload
     * @returns {Promise<object>}
     * @throws {AppError} 409 em violação de índice único (event_code duplicado no grupo)
     */
    insertPaymentReceipt(payload) { throw new Error('Not implemented'); }

    /** @param {object} filters @returns {Promise<object[]>} */
    findPaymentReceipts(filters) { throw new Error('Not implemented'); }

    /** @param {object} payload @returns {Promise<object|null>} */
    updatePaymentReceipt(payload) { throw new Error('Not implemented'); }

    /** @param {number} id @param {object} fields @param {string} updatedBy @param {string} updatedByBranchCode @returns {Promise<object|null>} */
    patchPaymentReceipt(id, fields, updatedBy, updatedByBranchCode) { throw new Error('Not implemented'); }

    /**
     * @param {?string} employeeCode @param {string} branchCode
     * @param {string} referenceInit @param {string} referenceEnd @param {?number} paymentTypeId
     * @param {?string} dateFrom @param {?string} dateTo
     * @returns {Promise<object[]>}
     */
    findReceipt(employeeCode, branchCode, referenceInit, referenceEnd, paymentTypeId, dateFrom, dateTo) { throw new Error('Not implemented'); }
}

module.exports = { GippRhRepositoryPort };
