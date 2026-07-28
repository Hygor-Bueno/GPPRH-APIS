/**
 * @fileoverview Casos de uso — GIPP (Gestão de Ponto e Pagamento).
 *
 * Gerencia o ciclo completo de jornadas de trabalho: marcações de ponto,
 * processamento (SQL Server + replicação no MySQL GIPP) e fechamento de
 * jornadas com inserção de recibos de pagamento.
 *
 * @module modules/gipp/application/gipp.use-cases
 */

const { randomUUID } = require('crypto');
const { AppError } = require('../../../errors/app.error');
const { validateTimeRecords } = require('../domain/time-record-validation.rules');
const { buildReceiptItems } = require('../domain/receipt-items.builder');

class GippUseCases {
    /**
     * @param {{
     *   repository: import('./ports/gipp-repository.port').GippRepositoryPort,
     *   replicationRepository: import('./ports/gipp-replication-repository.port').GippReplicationRepositoryPort,
     * }} deps
     */
    constructor({ repository, replicationRepository }) {
        this.repository = repository;
        this.replicationRepository = replicationRepository;
    }

    // ─── Consultas de Suporte ───────────────────────────────────────────────

    async getStatus() {
        return this.repository.findStatus();
    }

    async getPaymentRegistered() {
        return this.repository.findPaymentRegistered();
    }

    async getRecordTypes() {
        return this.repository.findRecordTypes();
    }

    // ─── Marcações de Ponto ─────────────────────────────────────────────────

    async getTimeRecordsByCodWork(codWorkSchedule) {
        return this.repository.findTimeRecordsByCodWork(codWorkSchedule);
    }

    async getTimeRecords(filters = {}) {
        return this.repository.findTimeRecords(filters);
    }

    async insertTimeRecord(payload, userId) {
        return this.repository.insertTimeRecord(payload, userId);
    }

    async updateTimeRecord(payload, userId) {
        return this.repository.updateTimeRecord(payload, userId);
    }

    // ─── Cancelamento e Processamento ───────────────────────────────────────

    async cancelWorkSchedule(codWorkSchedule) {
        return this.repository.cancelWorkSchedule(codWorkSchedule);
    }

    /**
     * Processa uma ou mais jornadas de trabalho em sequência completa:
     *   1. Executa o processamento no SQL Server (calcula pagamentos, atualiza status).
     *   2. Busca os dados de pagamento calculados para replicação.
     *   3. Replica cada pagamento no MySQL GIPP.
     *   4. Fecha as jornadas inserindo os recibos.
     * @throws {AppError} 404 se nenhum dado de pagamento for encontrado após o processamento
     */
    async processWorkSchedules(codWorkSchedules, userId, userBranchCode) {
        const scheduleList = Array.isArray(codWorkSchedules) ? codWorkSchedules : codWorkSchedules.split(',');
        const scheduleString = scheduleList.join(',');

        await this.repository.processWorkSchedules(scheduleString);

        const payments = await this.repository.findPaymentsForReplication(scheduleList);
        if (!payments.length) {
            throw new AppError('No payment data found after processing work schedules', 404);
        }

        for (const payment of payments) {
            await this.replicationRepository.replicatePayment(payment);
        }

        const closing = await this.closeWorkSchedules(scheduleList, userId, userBranchCode);

        return { payments, closing };
    }

    // ─── Fechamento de Jornada ──────────────────────────────────────────────

    /**
     * Fecha uma ou mais jornadas, inserindo os itens de recibo em `gipp_payment_receipt`.
     * Itens com `amount = 0` são omitidos automaticamente.
     *
     * @returns {Promise<Array<{cod_work_schedule:string, status:'inserted'|'skipped', items?:number, details?:object[], reason?:string}>>}
     * @throws {AppError} 404 se a jornada não for encontrada / 422 se a referência não puder ser
     *   determinada, os registros de ponto forem inválidos ou os valores de pagamento não existirem
     */
    async closeWorkSchedules(codWorkSchedules, userId, userBranchCode) {
        const scheduleList = Array.isArray(codWorkSchedules)
            ? codWorkSchedules
            : codWorkSchedules.split(',').map(s => s.trim());

        const results = [];

        for (const codWorkSchedule of scheduleList) {
            // 1 — Verifica duplicata pelo event_code que embute o cod_work_schedule
            const alreadyClosed = await this.repository.hasExistingReceipt(codWorkSchedule);
            if (alreadyClosed) {
                results.push({
                    cod_work_schedule: codWorkSchedule,
                    status: 'skipped',
                    reason: 'Recibo já gerado para esta jornada.',
                });
                continue;
            }

            // 2 — Dados da jornada + colaborador + empresa
            const ws = await this.repository.findWorkScheduleData(codWorkSchedule);
            if (!ws) {
                throw new AppError(`Jornada ${codWorkSchedule} não encontrada.`, 404);
            }

            // 3 — Valida registros de ponto (entrada obrigatória, pares de intervalo)
            const records = await this.repository.findTimeRecordsForValidation(codWorkSchedule);
            validateTimeRecords(records, codWorkSchedule);

            // 4 — Referência YYYYMM (derivada do primeiro registro de entrada)
            const { reference, work_date: workDate } = await this.repository.findWorkScheduleReference(codWorkSchedule);
            if (!reference) {
                throw new AppError(
                    `Jornada ${codWorkSchedule}: não foi possível determinar a referência (YYYYMM).`, 422
                );
            }

            // 5 — Valores de pagamento calculados no processamento
            const pay = await this.repository.findPaymentDataByCodWork(codWorkSchedule);
            if (!pay) {
                throw new AppError(
                    `Jornada ${codWorkSchedule}: valores de pagamento não encontrados. ` +
                    `Execute o processamento antes do fechamento.`, 422
                );
            }

            // 6 — UUID único por jornada + durações individuais
            const receiptGroupId = randomUUID();
            const dur = await this.repository.findWorkDurations(codWorkSchedule);

            const items = buildReceiptItems({
                ws, pay, dur, workDate, codWorkSchedule, reference, receiptGroupId, userId, userBranchCode,
            });

            if (!items.length) {
                results.push({
                    cod_work_schedule: codWorkSchedule,
                    status: 'skipped',
                    reason: 'Todos os valores de pagamento são zero.',
                });
                continue;
            }

            // 7 — Insere cada item; todos compartilham o mesmo receipt_group_id desta jornada
            for (const item of items) {
                await this.repository.insertReceiptItem(item);
            }

            results.push({
                cod_work_schedule: codWorkSchedule,
                status: 'inserted',
                items: items.length,
                details: items.map(i => ({ description: i.description, amount: i.amount })),
            });
        }

        return results;
    }
}

module.exports = { GippUseCases };
