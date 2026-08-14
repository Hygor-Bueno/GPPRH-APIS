/**
 * @fileoverview Casos de uso — Payee (prestadores de serviço/freelancers).
 * @module modules/global/application/payee/payee.use-cases
 */

const { AppError } = require('../../../../errors/app.error');

class PayeeUseCases {
    /** @param {{repository: import('./ports/payee-repository.port').PayeeRepositoryPort}} deps */
    constructor({ repository }) {
        this.repository = repository;
    }

    async getPayees(filters) {
        return this.repository.findAll(filters);
    }

    async createPayee(payload) {
        return this.repository.insert(payload);
    }

    /** @throws {AppError} 404 se o prestador não existir */
    async replacePayee(payload) {
        const payee = await this.repository.update(payload);
        if (!payee) throw new AppError('Payee not found', 404);
        return payee;
    }

    /** @throws {AppError} 400 se nenhum campo for enviado / 404 se o prestador não existir */
    async patchPayee(id, fields, updatedBy, updatedByBranchCode) {
        if (!Object.keys(fields).length) throw new AppError('No fields provided to update', 400);

        const payee = await this.repository.patch(id, fields, updatedBy, updatedByBranchCode);
        if (!payee) throw new AppError('Payee not found', 404);
        return payee;
    }

    /**
     * Remove um prestador, protegendo contra exclusão quando há recibos de
     * pagamento ativos vinculados (integridade referencial).
     * @throws {AppError} 404 se não existir / 409 se houver recibos vinculados
     */
    async deletePayee(id) {
        const exists = await this.repository.exists(id);
        if (!exists) throw new AppError('Payee not found', 404);

        const hasLinkedReceipts = await this.repository.hasActiveReceipts(id);
        if (hasLinkedReceipts) throw new AppError('Cannot delete payee with linked payment receipts', 409);

        await this.repository.remove(id);
        return { deleted: true };
    }
}

module.exports = { PayeeUseCases };
