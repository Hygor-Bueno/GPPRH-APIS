/**
 * @fileoverview Casos de uso — RH do GIPP (compensações, beneficiários,
 * colaboradores paginados, recibos de pagamento e dados para PDF).
 * @module modules/global/application/gipp-rh/gipp-rh.use-cases
 */

const { AppError } = require('../../../../errors/app.error');
const { WORK_SCHEDULE_STATUS } = require('../../../gipp/domain/work-schedule-status');

/** "Compra de folga" em `gipp_payment_type` — o único tipo que a tesouraria imprime. */
const TREASURY_PAYMENT_TYPE_ID = 6;

/**
 * Status de jornada que fornecem recibo para impressão.
 *
 * 6 (Pagando) é o que está em aberto; 4 (Finalizado) permite reimprimir o que já
 * foi fechado. Qualquer outro não tem recibo gerado ainda.
 */
const PRINTABLE_STATUSES = Object.freeze([
    WORK_SCHEDULE_STATUS.PAYING,
    WORK_SCHEDULE_STATUS.FINISHED,
]);

class GippRhUseCases {
    /** @param {{repository: import('./ports/gipp-rh-repository.port').GippRhRepositoryPort}} deps */
    constructor({ repository }) {
        this.repository = repository;
    }

    // ─── Compensações ───────────────────────────────────────────────────────

    async getActiveCompensations() {
        return this.repository.findActiveCompensations();
    }

    async createCompensation(payload) {
        return this.repository.insertCompensation(payload);
    }

    async updateCompensation(payload) {
        return this.repository.updateCompensation(payload);
    }

    // ─── Beneficiários ──────────────────────────────────────────────────────

    async getActiveBeneficiaries() {
        return this.repository.findActiveBeneficiaries();
    }

    async createBeneficiary(payload) {
        return this.repository.upsertBeneficiary(payload);
    }

    async updateBeneficiary(payload) {
        return this.repository.upsertBeneficiary(payload);
    }

    // ─── Colaboradores ──────────────────────────────────────────────────────

    async getEmployeesPaginated(filters) {
        return this.repository.findEmployeesPaginated(filters);
    }

    // ─── Recibos — dados para PDF ───────────────────────────────────────────

    async getReceiptData(employeeCode, branchCode, referenceInit, referenceEnd, payeeId = null) {
        return this.repository.findReceiptData(employeeCode, branchCode, referenceInit, referenceEnd, payeeId);
    }

    async getReceiptsByGroupIds(groupIds) {
        if (!groupIds?.length) return [];
        return this.repository.findReceiptsByGroupIds(groupIds);
    }

    // ─── Códigos de evento / Tipos de pagamento ─────────────────────────────

    async getEventCodes() {
        return this.repository.findEventCodes();
    }

    async getPaymentTypes() {
        return this.repository.findPaymentTypes();
    }

    // ─── Recibos de pagamento — CRUD ────────────────────────────────────────

    /** @throws {AppError} 400 se nem employee_code nem payee_id forem informados */
    async createPaymentReceipt(payload) {
        if (!payload.employee_code && !payload.payee_id) {
            throw new AppError("Informe 'employee_code' (CLT) ou 'payee_id' (prestador).", 400);
        }
        return this.repository.insertPaymentReceipt(payload);
    }

    async getPaymentReceipts(filters) {
        return this.repository.findPaymentReceipts(filters);
    }

    /** @throws {AppError} 404 se o recibo não for encontrado */
    async updatePaymentReceipt(payload) {
        const receipt = await this.repository.updatePaymentReceipt(payload);
        if (!receipt) throw new AppError('Recibo de pagamento não encontrado.', 404);
        return receipt;
    }

    /** @throws {AppError} 400 se nenhum campo for enviado / 404 se o recibo não for encontrado */
    async patchPaymentReceipt(id, fields, updatedBy, updatedByBranchCode) {
        if (!Object.keys(fields).length) {
            throw new AppError('Informe ao menos um campo para atualizar.', 400);
        }

        const receipt = await this.repository.patchPaymentReceipt(id, fields, updatedBy, updatedByBranchCode);
        if (!receipt) throw new AppError('Recibo de pagamento não encontrado.', 404);
        return receipt;
    }

    // ─── Recibos — listagem consolidada ─────────────────────────────────────

    async getReceipt(employeeCode, branchCode, referenceInit, referenceEnd, paymentTypeId, dateFrom, dateTo, workScheduleStatus) {
        return this.repository.findReceipt(
            employeeCode, branchCode, referenceInit, referenceEnd, paymentTypeId, dateFrom, dateTo, workScheduleStatus
        );
    }

    // ─── Tesouraria ─────────────────────────────────────────────────────────

    /**
     * Recibos de compra de folga para a tesouraria imprimir.
     *
     * Travada em `payment_type_id = 6` (Compra de folga): a tesouraria não
     * imprime salário, férias nem rescisão por aqui.
     *
     * `workScheduleStatus` é opcional — o padrão é 6 (Pagando), o que está em
     * aberto. Passando 4 (Finalizado) ela reimprime o que já foi fechado.
     */
    async getTreasuryReceipts(filters = {}) {
        const status = filters.workScheduleStatus !== undefined && filters.workScheduleStatus !== null
            ? Number(filters.workScheduleStatus)
            : WORK_SCHEDULE_STATUS.PAYING;

        if (!PRINTABLE_STATUSES.includes(status)) {
            throw new AppError(
                `Status ${status} não fornece recibo para impressão. ` +
                `Use ${WORK_SCHEDULE_STATUS.PAYING} (em aberto) ou ${WORK_SCHEDULE_STATUS.FINISHED} (reimpressão).`,
                400,
                { code: 'INVALID_PRINT_STATUS' },
            );
        }

        return this.repository.findReceipt(
            null,
            filters.branchCode || null,
            filters.referenceInit || null,
            filters.referenceEnd || null,
            TREASURY_PAYMENT_TYPE_ID,
            filters.dateFrom || null,
            filters.dateTo || null,
            status,
        );
    }

    /**
     * Fecha as jornadas depois da impressão: 6 (Pagando) → 4 (Finalizado).
     *
     * Separado da impressão de propósito: o GET não altera estado, então
     * reimprimir não muda nada, e uma falha na geração do PDF não deixa a jornada
     * fechada sem ter sido impressa — o que seria irreversível, já que a partir
     * do 6 ninguém cancela.
     *
     * @param {string[]|string} codWorkSchedules
     * @returns {Promise<{confirmed: string[], skipped: Array<{cod_work_schedule: string, status: ?number, reason: string}>}>}
     */
    async confirmTreasuryPayment(codWorkSchedules, actor = null) {
        const requested = Array.isArray(codWorkSchedules)
            ? codWorkSchedules
            : String(codWorkSchedules).split(',');

        const codes = [...new Set(requested.map(c => String(c).trim()).filter(Boolean))];
        if (!codes.length) {
            throw new AppError('Informe ao menos uma jornada.', 400, { code: 'EMPTY_SCHEDULE_LIST' });
        }

        const current = await this.repository.findWorkSchedulesStatus(codes);
        const statusByCode = new Map(current.map(r => [r.cod_work_schedule, r.id_status_fk]));

        const confirmed = [];
        const skipped = [];

        for (const code of codes) {
            const status = statusByCode.get(code);

            if (status === undefined) {
                skipped.push({ cod_work_schedule: code, status: null, reason: 'not_found' });
            } else if (status !== WORK_SCHEDULE_STATUS.PAYING) {
                skipped.push({ cod_work_schedule: code, status, reason: 'not_paying' });
            } else {
                confirmed.push(code);
            }
        }

        if (confirmed.length) {
            await this.repository.confirmTreasuryPayment(confirmed, actor);
        }

        return { confirmed, skipped };
    }
}

module.exports = { GippRhUseCases };
