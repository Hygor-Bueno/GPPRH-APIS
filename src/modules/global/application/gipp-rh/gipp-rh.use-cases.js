/**
 * @fileoverview Casos de uso — RH do GIPP (compensações, beneficiários,
 * colaboradores paginados, recibos de pagamento e dados para PDF).
 * @module modules/global/application/gipp-rh/gipp-rh.use-cases
 */

const { AppError } = require('../../../../errors/app.error');

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
        if (!receipt) throw new AppError('Payment receipt not found', 404);
        return receipt;
    }

    /** @throws {AppError} 400 se nenhum campo for enviado / 404 se o recibo não for encontrado */
    async patchPaymentReceipt(id, fields, updatedBy, updatedByBranchCode) {
        if (!Object.keys(fields).length) {
            throw new AppError('No fields provided to update', 400);
        }

        const receipt = await this.repository.patchPaymentReceipt(id, fields, updatedBy, updatedByBranchCode);
        if (!receipt) throw new AppError('Payment receipt not found', 404);
        return receipt;
    }

    // ─── Recibos — listagem consolidada ─────────────────────────────────────

    async getReceipt(employeeCode, branchCode, referenceInit, referenceEnd, paymentTypeId, dateFrom, dateTo) {
        return this.repository.findReceipt(employeeCode, branchCode, referenceInit, referenceEnd, paymentTypeId, dateFrom, dateTo);
    }
}

module.exports = { GippRhUseCases };
