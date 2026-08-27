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

    /**
     * Jornadas vinculadas aos recibos dos grupos informados, com o status atual.
     *
     * Recibo sem jornada (adiantamento, por exemplo) fica de fora: `work_schedule_id`
     * nulo não tem o que fechar.
     *
     * @param {string[]} groupIds
     * @returns {Promise<Array<{cod_work_schedule: string, id_status_fk: number}>>}
     */
    findWorkSchedulesByReceiptGroupIds(groupIds) { throw new Error('Not implemented'); }

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

    // ─── Jornadas (GIPP) ────────────────────────────────────────────────────
    // O adapter já implementava os dois; a porta não os declarava. Sem a
    // declaração, um adapter alternativo (ou um fake de teste) passaria a
    // checagem de contrato sem ter o método — e a falha só apareceria em
    // produção, na hora de fechar o pagamento.

    /**
     * Estado atual das jornadas — usado para separar o que a tesouraria pode
     * fechar do que precisa voltar como ignorado.
     * @param {string[]} scheduleList
     * @returns {Promise<Array<{cod_work_schedule: string, id_status_fk: number}>>}
     */
    findWorkSchedulesStatus(scheduleList) { throw new Error('Not implemented'); }

    /**
     * Fecha as jornadas da tesouraria: 6 (Pagando) → 4 (Finalizado).
     *
     * O `actor` não altera nenhuma coluna de `cf_work_schedules` — ele vai para
     * o `SESSION_CONTEXT`, de onde o trigger de histórico lê o responsável.
     * Omitir o ator grava a transição como anônima.
     *
     * @param {string[]} scheduleList
     * @param {import('../../../../utils/audit-actor').AuditActor} [actor]
     * @returns {Promise<number>} Linhas afetadas.
     */
    confirmTreasuryPayment(scheduleList, actor) { throw new Error('Not implemented'); }
}

module.exports = { GippRhRepositoryPort };
