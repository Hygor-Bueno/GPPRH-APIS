/**
 * @fileoverview Porta (contrato) de persistência SQL Server — GIPP.
 * @module modules/gipp/application/ports/gipp-repository.port
 */

class GippRepositoryPort {
    // ─── Status e Tipos ─────────────────────────────────────────────────────
    findStatus() { throw new Error('Not implemented'); }

    /** @param {{branch?: ?string, costCenter?: ?string}} filters @returns {Promise<object[]>} */
    findPaymentRegistered(filters) { throw new Error('Not implemented'); }

    /**
     * Mesma leitura de `findPaymentRegistered`, restrita a um único status.
     * @param {number} status - Valor de `WORK_SCHEDULE_STATUS`, nunca vindo do cliente.
     * @param {{branch?: ?string, costCenter?: ?string}} filters
     * @param {{withValues?: boolean}} [options] - `withValues` só para a fila do RH.
     * @returns {Promise<object[]>}
     */
    findPaymentByStatus(status, filters, options) { throw new Error('Not implemented'); }

    /**
     * Jornadas em status 1 e 2 lançadas por um usuário específico.
     * @param {number} launchedBy - `id_global` de quem lançou a entrada.
     * @param {{branch?: ?string, costCenter?: ?string}} filters
     * @returns {Promise<object[]>}
     */
    findPaymentByLauncher(launchedBy, filters) { throw new Error('Not implemented'); }

    findRecordTypes() { throw new Error('Not implemented'); }

    // ─── Registros de Ponto ─────────────────────────────────────────────────
    /** @param {string} codWorkSchedule @returns {Promise<object[]>} */
    findTimeRecordsByCodWork(codWorkSchedule) { throw new Error('Not implemented'); }

    /** @param {object} filters @returns {Promise<object[]>} */
    findTimeRecords(filters) { throw new Error('Not implemented'); }

    /**
     * O `actor` descreve QUEM lançou — vira `id_global`,
     * `registration_snapshot` e `branch_code_snapshot` na mesma linha. O
     * colaborador da jornada vem no `payload` (`employee_id`,
     * `branch_time_record`) e é outra pessoa.
     * @param {object} payload
     * @param {import('../../../../utils/audit-actor').AuditActor} actor
     * @returns {Promise<object[]>}
     */
    insertTimeRecord(payload, actor) { throw new Error('Not implemented'); }

    /**
     * @param {object} payload
     * @param {import('../../../../utils/audit-actor').AuditActor} actor
     * @returns {Promise<object[]>}
     */
    updateTimeRecord(payload, actor) { throw new Error('Not implemented'); }

    // ─── Jornadas de Trabalho ───────────────────────────────────────────────
    /**
     * Só cancela jornada aberta (1) ou aguardando aprovação (2).
     * @param {string} codWorkSchedule
     * @returns {Promise<number>} Linhas afetadas — 0 quando a guarda de status barra.
     */
    cancelWorkSchedule(codWorkSchedule, allowedStatuses, actor) { throw new Error('Not implemented'); }

    /**
     * @param {string[]} scheduleList
     * @returns {Promise<Array<{cod_work_schedule: string, id_status_fk: number}>>}
     */
    findWorkSchedulesStatus(scheduleList) { throw new Error('Not implemented'); }

    /**
     * Move jornadas de `fromStatus` para `toStatus`, ignorando as que não
     * estiverem em `fromStatus`.
     * @param {string[]} scheduleList
     * @param {number} fromStatus
     * @param {number} toStatus
     * @returns {Promise<number>} Linhas afetadas.
     */
    approveWorkSchedules(scheduleList, fromStatus, toStatus, audit) { throw new Error('Not implemented'); }

    /**
     * Devolve uma jornada de 4 (finalizada) para 3 (fila do RH).
     *
     * Usado quando a procedure já marcou como finalizada mas a geração do recibo
     * falhou — sem isso a jornada fica marcada como paga sem recibo, e o discard
     * não alcança status 4.
     *
     * @param {string} codWorkSchedule
     * @returns {Promise<number>} Linhas afetadas.
     */
    revertToPayrollQueue(codWorkSchedule, actor) { throw new Error('Not implemented'); }

    /** @param {string} scheduleCsv - Códigos separados por vírgula. */
    processWorkSchedules(scheduleCsv, actor) { throw new Error('Not implemented'); }

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
