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

/** Formato de `gipp_payment_receipt.receipt_group_id` — UNIQUEIDENTIFIER no banco. */
const RECEIPT_GROUP_ID_PATTERN =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Normaliza e valida a lista de grupos de recibo.
 *
 * A coluna é UNIQUEIDENTIFIER, então um único item malformado no array aborta a
 * query **inteira** com "Conversion failed when converting from a character
 * string to uniqueidentifier" — o lote todo cai por causa de um id ruim, e o
 * cliente recebe um 500 que não diz qual. Barrar aqui troca isso por um 400 que
 * nomeia os culpados.
 *
 * Verificado no banco: `''`, `'abc'` e `'   '` derrubam a consulta.
 *
 * @param {string[]} groupIds
 * @returns {string[]} Ids em caixa alta, sem espaços, sem repetição.
 * @throws {AppError} 400 se não for lista, se ficar vazia ou se houver id inválido.
 */
function normalizeReceiptGroupIds(groupIds) {
    if (!Array.isArray(groupIds)) {
        throw new AppError("'receipt_group_ids' deve ser uma lista.", 400, {
            code: 'INVALID_RECEIPT_GROUP_IDS',
        });
    }

    const seen = new Set();
    const valid = [];
    const invalid = [];

    for (const raw of groupIds) {
        const id = String(raw ?? '').trim();
        if (!id) { invalid.push(String(raw)); continue; }
        if (!RECEIPT_GROUP_ID_PATTERN.test(id)) { invalid.push(id); continue; }

        // O banco devolve o GUID em caixa alta; normalizar evita que o mesmo
        // grupo entre duas vezes só por diferença de caixa.
        const key = id.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        valid.push(key);
    }

    if (invalid.length) {
        throw new AppError(
            `Grupo de recibo inválido: ${invalid.join(', ')}.`,
            400,
            { code: 'INVALID_RECEIPT_GROUP_IDS', details: { invalid } },
        );
    }

    if (!valid.length) {
        throw new AppError("Informe ao menos um 'receipt_group_id'.", 400, {
            code: 'EMPTY_RECEIPT_GROUP_IDS',
        });
    }

    return valid;
}

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
        return this.repository.findReceiptsByGroupIds(normalizeReceiptGroupIds(groupIds));
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

    /**
     * Mesma transição 6 → 4, resolvida a partir dos grupos de recibo em vez das
     * jornadas — é o que a impressão consolidada tem em mãos.
     *
     * Chame **depois** de gerar o PDF com sucesso: fechar antes deixaria a
     * jornada finalizada sem ter sido impressa, e do 6 em diante ninguém
     * cancela. O UPDATE filtra `id_status_fk = 6`, então reimprimir algo já
     * finalizado não altera nada — a jornada volta em `skipped`.
     *
     * @param {string[]} groupIds
     * @param {import('../../../../utils/audit-actor').AuditActor} [actor]
     * @returns {Promise<{confirmed: string[], skipped: Array<{cod_work_schedule: string, status: number, reason: string}>}>}
     */
    async confirmTreasuryPaymentByReceiptGroupIds(groupIds, actor = null) {
        const ids = normalizeReceiptGroupIds(groupIds);
        const schedules = await this.repository.findWorkSchedulesByReceiptGroupIds(ids);

        const confirmed = [];
        const skipped = [];

        for (const { cod_work_schedule, id_status_fk } of schedules) {
            if (id_status_fk === WORK_SCHEDULE_STATUS.PAYING) {
                confirmed.push(cod_work_schedule);
            } else {
                skipped.push({ cod_work_schedule, status: id_status_fk, reason: 'not_paying' });
            }
        }

        if (confirmed.length) {
            await this.repository.confirmTreasuryPayment(confirmed, actor);
        }

        return { confirmed, skipped };
    }

    /**
     * Desfaz o fechamento automático da impressão consolidada: 4 → 6.
     *
     * Compensação, não transação: o UPDATE que fechou já commitou quando isto
     * roda. Passe **apenas** os códigos que a própria requisição fechou — o
     * repositório filtra `id_status_fk = 4`, mas reenviar jornada que já estava
     * finalizada antes da impressão a reabriria indevidamente.
     *
     * @param {string[]} codWorkSchedules
     * @param {import('../../../../utils/audit-actor').AuditActor} [actor]
     * @returns {Promise<number>} Jornadas revertidas.
     */
    async revertTreasuryPayment(codWorkSchedules, actor = null) {
        const codes = [...new Set((codWorkSchedules || []).map(c => String(c).trim()).filter(Boolean))];
        if (!codes.length) return 0;
        return this.repository.revertTreasuryPayment(codes, actor);
    }
}

module.exports = { GippRhUseCases };
