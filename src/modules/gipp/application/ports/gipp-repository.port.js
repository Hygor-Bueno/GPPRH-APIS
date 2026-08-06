/**
 * @fileoverview Porta (contrato) de persistência SQL Server — GIPP.
 * @module modules/gipp/application/ports/gipp-repository.port
 */

class GippRepositoryPort {
    // ─── Status e Tipos ─────────────────────────────────────────────────────
    findStatus() { throw new Error('Not implemented'); }

    /** @param {{branch?: ?string, costCenter?: ?string}} filters @returns {Promise<object[]>} */
    findPaymentRegistered(filters) { throw new Error('Not implemented'); }

    findRecordTypes() { throw new Error('Not implemented'); }

    // ─── Registros de Ponto ─────────────────────────────────────────────────
    /** @param {string} codWorkSchedule @returns {Promise<object[]>} */
    findTimeRecordsByCodWork(codWorkSchedule) { throw new Error('Not implemented'); }

    /** @param {object} filters @returns {Promise<object[]>} */
    findTimeRecords(filters) { throw new Error('Not implemented'); }

    /** @param {object} payload @param {number} userId @returns {Promise<object[]>} */
    insertTimeRecord(payload, userId) { throw new Error('Not implemented'); }

    /** @param {object} payload @param {number} userId @returns {Promise<object[]>} */
    updateTimeRecord(payload, userId) { throw new Error('Not implemented'); }

    // ─── Jornadas de Trabalho ───────────────────────────────────────────────
    /** @param {string} codWorkSchedule */
    cancelWorkSchedule(codWorkSchedule) { throw new Error('Not implemented'); }

    /** @param {string} scheduleCsv - Códigos separados por vírgula. */
    processWorkSchedules(scheduleCsv) { throw new Error('Not implemented'); }

    /** @param {string[]} scheduleList @returns {Promise<object[]>} */
    findPaymentsForReplication(scheduleList) { throw new Error('Not implemented'); }

    // ─── Fechamento de Jornada ──────────────────────────────────────────────
    /** @param {string} codWorkSchedule @returns {Promise<boolean>} */
    hasExistingReceipt(codWorkSchedule) { throw new Error('Not implemented'); }

    /** @param {string} codWorkSchedule @returns {Promise<object|null>} */
    findWorkScheduleData(codWorkSchedule) { throw new Error('Not implemented'); }

    /** @param {string} codWorkSchedule @returns {Promise<object[]>} */
    findTimeRecordsForValidation(codWorkSchedule) { throw new Error('Not implemented'); }

    /** @param {string} codWorkSchedule @returns {Promise<{reference:?string, work_date:?string}>} */
    findWorkScheduleReference(codWorkSchedule) { throw new Error('Not implemented'); }

    /** @param {string} codWorkSchedule @returns {Promise<object|null>} */
    findPaymentDataByCodWork(codWorkSchedule) { throw new Error('Not implemented'); }

    /** @param {string} codWorkSchedule @returns {Promise<object|null>} */
    findWorkDurations(codWorkSchedule) { throw new Error('Not implemented'); }

    /** @param {object} item */
    insertReceiptItem(item) { throw new Error('Not implemented'); }
}

module.exports = { GippRepositoryPort };
