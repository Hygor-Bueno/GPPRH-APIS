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
const { WORK_SCHEDULE_STATUS } = require('../domain/work-schedule-status');

/**
 * Normaliza filtro vindo da query string: string vazia ou só espaços vira null,
 * pra não ser confundida com filtro informado.
 * @param {*} value
 * @returns {?string}
 */
function trimOrNull(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

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

    /**
     * Resumo de jornadas em aberto, filtrado por filial e/ou centro de custo.
     *
     * Sem nenhum filtro retorna lista vazia sem tocar o banco: a view não é
     * paginada e roda sobre cinco níveis de subquery com funções escalares,
     * então uma consulta sem critério paga o cálculo inteiro. Exigir ao menos
     * um filtro mantém a requisição barata.
     *
     * @param {{branch?: string, costCenter?: string}} [filters]
     * @returns {Promise<object[]>}
     */
    async getPaymentRegistered(filters = {}) {
        const branch = trimOrNull(filters.branch);
        const costCenter = trimOrNull(filters.costCenter);

        if (!branch && !costCenter) return [];

        return this.repository.findPaymentRegistered({ branch, costCenter });
    }

    /**
     * Fila do gerente — jornadas fechadas pelo encarregado, aguardando aprovação.
     *
     * Mesma exigência de filtro de `getPaymentRegistered`: sem filial nem centro
     * de custo devolve lista vazia sem tocar o banco, porque a view roda sobre
     * cinco níveis de subquery com funções escalares e não é paginada.
     *
     * @param {{branch?: string, costCenter?: string}} [filters]
     * @returns {Promise<object[]>}
     */
    async getPendingApproval(filters = {}) {
        // Sem valores: o gerente aprova olhando as horas. Salário e valor a pagar
        // são informação de RH e não precisam circular na gerência de loja.
        return this._getPaymentByStatus(WORK_SCHEDULE_STATUS.AWAITING_APPROVAL, filters, false);
    }

    /**
     * Fila do RH — jornadas já aprovadas pelo gerente, aguardando finalização.
     *
     * @param {{branch?: string, costCenter?: string}} [filters]
     * @returns {Promise<object[]>}
     */
    async getApprovedPayments(filters = {}) {
        // Única fila com valores: é o RH conferindo o que vai pagar.
        return this._getPaymentByStatus(WORK_SCHEDULE_STATUS.AWAITING_PAYROLL, filters, true);
    }

    /**
     * Fila do encarregado — o que ele mesmo lançou e ainda não foi aprovado.
     *
     * Não exige filial nem centro de custo, ao contrário das outras filas: o
     * `launchedBy` já restringe o conjunto ao que uma pessoa registrou, então a
     * consulta não fica cara sem filtro. É o que permite o encarregado abrir o
     * app e ver as jornadas dele sem escolher filial antes.
     *
     * @param {number} launchedBy - `id_global`, resolvido pelo controller a
     *   partir do token; só quem tem permissão de gestão consegue informar outro.
     * @param {{branch?: string, costCenter?: string}} [filters]
     * @returns {Promise<object[]>}
     * @throws {AppError} 400 se o identificador do lançador não for válido
     */
    async getPaymentByLauncher(launchedBy, filters = {}) {
        const id = Number(launchedBy);
        if (!Number.isInteger(id) || id <= 0) {
            throw new AppError('A valid launcher id is required', 400);
        }

        return this.repository.findPaymentByLauncher(id, {
            branch: trimOrNull(filters.branch),
            costCenter: trimOrNull(filters.costCenter),
        });
    }

    /**
     * Base das duas filas acima. O status é sempre uma constante do domínio,
     * escolhida pela rota — nunca um valor recebido do cliente.
     *
     * @param {number} status
     * @param {{branch?: string, costCenter?: string}} filters
     * @param {boolean} [withValues=false] - Expor salário e valores a pagar.
     * @returns {Promise<object[]>}
     * @private
     */
    async _getPaymentByStatus(status, filters, withValues = false) {
        const branch = trimOrNull(filters.branch);
        const costCenter = trimOrNull(filters.costCenter);

        if (!branch && !costCenter) return [];

        return this.repository.findPaymentByStatus(
            status,
            { branch, costCenter },
            { withValues },
        );
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

    // ─── Aprovação do Gerente ───────────────────────────────────────────────

    /**
     * Aprova uma ou mais jornadas: 2 (aguardando aprovação) → 3 (aguardando RH).
     *
     * Jornadas fora do status 2 não são alteradas e voltam em `skipped` com o
     * estado em que estavam, para o gerente entender o que aconteceu em vez de
     * receber um sucesso parcial mudo.
     *
     * @param {string[]|string} codWorkSchedules
     * @returns {Promise<{approved: string[], skipped: Array<{cod_work_schedule: string, status: ?number, reason: string}>}>}
     * @throws {AppError} 400 se a lista vier vazia
     */
    async approveWorkSchedules(codWorkSchedules) {
        const scheduleList = Array.isArray(codWorkSchedules)
            ? codWorkSchedules
            : String(codWorkSchedules).split(',');

        const codes = scheduleList.map(c => String(c).trim()).filter(Boolean);
        if (!codes.length) {
            throw new AppError('codWorkSchedules is required and must not be empty', 400);
        }

        const current = await this.repository.findWorkSchedulesStatus(codes);
        const statusByCode = new Map(current.map(r => [r.cod_work_schedule, r.id_status_fk]));

        const approved = [];
        const skipped = [];

        for (const code of codes) {
            const status = statusByCode.get(code);

            if (status === undefined) {
                skipped.push({ cod_work_schedule: code, status: null, reason: 'not_found' });
            } else if (status !== WORK_SCHEDULE_STATUS.AWAITING_APPROVAL) {
                skipped.push({ cod_work_schedule: code, status, reason: 'invalid_status' });
            } else {
                approved.push(code);
            }
        }

        if (approved.length) {
            await this.repository.approveWorkSchedules(
                approved,
                WORK_SCHEDULE_STATUS.AWAITING_APPROVAL,
                WORK_SCHEDULE_STATUS.AWAITING_PAYROLL,
            );
        }

        return { approved, skipped };
    }

    // ─── Cancelamento e Processamento ───────────────────────────────────────

    /**
     * Desconsidera uma jornada (→ 5). Serve tanto para o encarregado limpar
     * uma jornada aberta quanto para o gerente reprovar uma que está na fila.
     *
     * Só jornada em 1 ou 2 pode ser cancelada: sem essa checagem, um código de
     * jornada já finalizada apagaria um pagamento fechado.
     *
     * @param {string} codWorkSchedule
     * @throws {AppError} 404 se a jornada não existe / 409 se já saiu do fluxo
     */
    async cancelWorkSchedule(codWorkSchedule) {
        const [current] = await this.repository.findWorkSchedulesStatus([codWorkSchedule]);

        if (!current) {
            throw new AppError(`Work schedule ${codWorkSchedule} not found`, 404);
        }

        const cancellable = [
            WORK_SCHEDULE_STATUS.OPEN,
            WORK_SCHEDULE_STATUS.AWAITING_APPROVAL
        ];
        
        if (!cancellable.includes(current.id_status_fk)) {
            throw new AppError(
                `Work schedule ${codWorkSchedule} is in status ${current.id_status_fk} and can no longer be discarded`,
                409,
            );
        }

        const affected = await this.repository.cancelWorkSchedule(codWorkSchedule);

        // A checagem acima e o UPDATE são duas idas ao banco: entre uma e outra o
        // gerente pode ter aprovado a mesma jornada. Aí a guarda do UPDATE barra e
        // nada é alterado — sem este teste, o usuário receberia "desconsiderada
        // com sucesso" para uma jornada que seguiu para o RH.
        // if (affected === 0) {
        //     throw new AppError(
        //         `Work schedule ${codWorkSchedule} changed status concurrently and was not discarded`,
        //         409,
        //     );
        // }

        return affected;
    }

    /**
     * Processa uma ou mais jornadas de trabalho em sequência completa:
     *   0. Recusa o que não estiver aprovado pelo gerente (status 3).
     *   1. Executa o processamento no SQL Server (calcula pagamentos, atualiza status).
     *   2. Busca os dados de pagamento calculados para replicação.
     *   3. Replica cada pagamento no MySQL GIPP.
     *   4. Fecha as jornadas inserindo os recibos.
     *
     * O passo 0 entrou em 08/2026 junto com a etapa de aprovação. Sem ele o RH
     * conseguiria finalizar uma jornada que o gerente ainda não olhou — ou que
     * ele reprovou —, e o pagamento seria gerado do mesmo jeito.
     *
     * @throws {AppError} 409 se nenhuma jornada da lista estiver aprovada
     * @throws {AppError} 404 se nenhum dado de pagamento for encontrado após o processamento
     */
    async processWorkSchedules(codWorkSchedules, userId, userBranchCode) {
        const requested = Array.isArray(codWorkSchedules) ? codWorkSchedules : codWorkSchedules.split(',');

        const current = await this.repository.findWorkSchedulesStatus(requested);
        const statusByCode = new Map(current.map(r => [r.cod_work_schedule, r.id_status_fk]));

        const scheduleList = [];
        const rejected = [];

        for (const code of requested) {
            const status = statusByCode.get(code);

            if (status === undefined) {
                rejected.push({ cod_work_schedule: code, status: null, reason: 'not_found' });
            } else if (status !== WORK_SCHEDULE_STATUS.AWAITING_PAYROLL) {
                rejected.push({ cod_work_schedule: code, status, reason: 'not_approved' });
            } else {
                scheduleList.push(code);
            }
        }

        if (!scheduleList.length) {
            throw new AppError(
                'No work schedule approved by the manager (status 3) in the given list',
                409,
            );
        }

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

        return { payments, closing, rejected };
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
