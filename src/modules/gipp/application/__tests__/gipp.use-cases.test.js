const { GippUseCases } = require('../gipp.use-cases');
const { GippRepositoryPort } = require('../ports/gipp-repository.port');
const { GippReplicationRepositoryPort } = require('../ports/gipp-replication-repository.port');
const { AppError } = require('../../../../errors/app.error');
const { CHANGE_REASON } = require('../../domain/work-schedule-change-reason');

const WS = { company_code: 1, branch_time_record: 203, employee_id: 4043, employee_name: 'Fulano', branch_name: 'Taboao' };
const VALID_RECORDS = [{ id_record_type_fk: 1 }, { id_record_type_fk: 4 }];

function makeFakeRepository(overrides = {}) {
    const repo = new GippRepositoryPort();
    repo.findStatus = jest.fn().mockResolvedValue([{ id: 1 }]);
    repo.findPaymentRegistered = jest.fn().mockResolvedValue([{ id: 1 }]);
    repo.findPaymentByStatus = jest.fn().mockResolvedValue([{ id: 1 }]);
    repo.findPaymentByLauncher = jest.fn().mockResolvedValue([{ id: 1 }]);
    repo.findRecordTypes = jest.fn().mockResolvedValue([{ id: 1 }]);
    repo.findTimeRecordsByCodWork = jest.fn().mockResolvedValue([{ id: 1 }]);
    repo.findTimeRecords = jest.fn().mockResolvedValue([{ id: 1 }]);
    repo.insertTimeRecord = jest.fn().mockResolvedValue([{ id: 1 }]);
    repo.updateTimeRecord = jest.fn().mockResolvedValue([{ id: 1 }]);
    repo.cancelWorkSchedule = jest.fn().mockResolvedValue(1);
    // Caminho feliz: toda jornada consultada já foi aprovada pelo gerente (3).
    // Testes que exercitam outras transições sobrescrevem este mock.
    repo.findWorkSchedulesStatus = jest.fn().mockImplementation(
        async codes => codes.map(c => ({ cod_work_schedule: c, id_status_fk: 3 })),
    );
    repo.approveWorkSchedules = jest.fn().mockResolvedValue(0);
    repo.processWorkSchedules = jest.fn().mockResolvedValue();
    repo.findPaymentsForReplication = jest.fn().mockResolvedValue([{ cpf: '111' }]);
    repo.hasExistingReceipt = jest.fn().mockResolvedValue(false);
    repo.findWorkScheduleData = jest.fn().mockResolvedValue(WS);
    repo.findTimeRecordsForValidation = jest.fn().mockResolvedValue(VALID_RECORDS);
    repo.findWorkScheduleReference = jest.fn().mockResolvedValue({ reference: '202607', work_date: '15/07/2026' });
    repo.findPaymentDataByCodWork = jest.fn().mockResolvedValue({ normal_payment: 100, extra_hour_payment: 0, night_bonus_payment: 0 });
    repo.findWorkDurations = jest.fn().mockResolvedValue({ FullExpedient: 1 });
    repo.insertReceiptItem = jest.fn().mockResolvedValue();
    repo.revertToPayrollQueue = jest.fn().mockResolvedValue(1);
    return Object.assign(repo, overrides);
}

function makeFakeReplicationRepository(overrides = {}) {
    const repo = new GippReplicationRepositoryPort();
    repo.replicatePayment = jest.fn().mockResolvedValue();
    return Object.assign(repo, overrides);
}

function makeUseCases({ repository, replicationRepository } = {}) {
    return new GippUseCases({
        repository: repository ?? makeFakeRepository(),
        replicationRepository: replicationRepository ?? makeFakeReplicationRepository(),
    });
}

describe('GippUseCases', () => {
    describe('getPaymentRegistered', () => {
        it('should return an empty list without touching the database when no filter is given', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await expect(useCases.getPaymentRegistered()).resolves.toEqual([]);
            expect(repository.findPaymentRegistered).not.toHaveBeenCalled();
        });

        it('should treat blank filters as absent', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            const results = await useCases.getPaymentRegistered({ branch: '   ', costCenter: '' });
            expect(results).toEqual([]);
            expect(repository.findPaymentRegistered).not.toHaveBeenCalled();
        });

        it('should query with only the branch filter', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.getPaymentRegistered({ branch: '0208' });
            expect(repository.findPaymentRegistered).toHaveBeenCalledWith({ branch: '0208', costCenter: null });
        });

        it('should query with only the cost center filter', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.getPaymentRegistered({ costCenter: '1006' });
            expect(repository.findPaymentRegistered).toHaveBeenCalledWith({ branch: null, costCenter: '1006' });
        });

        it('should trim both filters and combine them', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.getPaymentRegistered({ branch: ' 208 ', costCenter: ' 1006 ' });
            expect(repository.findPaymentRegistered).toHaveBeenCalledWith({ branch: '208', costCenter: '1006' });
        });
    });

    // Estados: 1=aberta, 2=aguardando aprovação, 3=aguardando RH, 4=finalizada, 5=cancelada
    const status = (cod, id_status_fk) => ({ cod_work_schedule: cod, id_status_fk });

    describe('exposição de valores monetários', () => {
        // Salário e valor a pagar são informação de RH. Encarregado e gerente
        // decidem pelas horas — só a fila do RH devolve os valores.
        it('should expose values only in the payroll queue', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });

            await useCases.getApprovedPayments({ branch: '0203' });

            expect(repository.findPaymentByStatus).toHaveBeenCalledWith(
                3, expect.anything(), { withValues: true },
            );
        });

        it('should hide values from the manager queue', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });

            await useCases.getPendingApproval({ branch: '0203' });

            expect(repository.findPaymentByStatus).toHaveBeenCalledWith(
                2, expect.anything(), { withValues: false },
            );
        });
    });

    describe('OPERATION_VISIBLE_STATUSES', () => {
        it('deve incluir 1, 2, 3 e 6 — tudo que não encerrou', () => {
            const { OPERATION_VISIBLE_STATUSES } = require('../../domain/work-schedule-status');
            expect(OPERATION_VISIBLE_STATUSES).toEqual([1, 2, 3, 6]);
        });

        it('não deve incluir finalizada (4) nem cancelada (5)', () => {
            const { OPERATION_VISIBLE_STATUSES } = require('../../domain/work-schedule-status');
            expect(OPERATION_VISIBLE_STATUSES).not.toContain(4);
            expect(OPERATION_VISIBLE_STATUSES).not.toContain(5);
        });

        it('não deve permitir cancelar jornada em Pagando (6) nem Finalizado (4)', () => {
            const {
                DISCARDABLE_STATUSES,
                PAYROLL_DISCARDABLE_STATUSES,
            } = require('../../domain/work-schedule-status');

            // Depois que o RH gera os recibos, ninguém cancela via software.
            for (const lista of [DISCARDABLE_STATUSES, PAYROLL_DISCARDABLE_STATUSES]) {
                expect(lista).not.toContain(6);
                expect(lista).not.toContain(4);
            }
        });

        it('deve ordenar o fluxo por workflow_order, não por id', () => {
            const { WORKFLOW_ORDER, WORK_SCHEDULE_STATUS } = require('../../domain/work-schedule-status');

            // 6 (Pagando) vem ANTES de 4 (Finalizado), apesar do id maior.
            expect(WORKFLOW_ORDER[WORK_SCHEDULE_STATUS.PAYING])
                .toBeLessThan(WORKFLOW_ORDER[WORK_SCHEDULE_STATUS.FINISHED]);
            // 5 (Cancelado) está fora da linha, na ordem 0.
            expect(WORKFLOW_ORDER[WORK_SCHEDULE_STATUS.CANCELLED]).toBe(0);
        });
    });

    describe('sqlGetPaymentByLauncher — colunas de status', () => {
        const { sqlGetPaymentByLauncher } = require('../../repositories/sqlserver/gipp.queries');

        it('deve trazer name, description e workflow_order de cf_status', () => {
            const sql = sqlGetPaymentByLauncher();

            expect(sql).toMatch(/st\.name\s+AS status_name/);
            expect(sql).toMatch(/st\.description\s+AS status_description/);
            expect(sql).toMatch(/st\.workflow_order\s+AS status_order/);
            expect(sql).toContain('LEFT JOIN GIPP.dbo.cf_status st');
        });

        it('deve ordenar por workflow_order, não por id_status_fk', () => {
            // Pelo id, "Pagando" (6) viria depois de "Finalizado" (4).
            expect(sqlGetPaymentByLauncher()).toMatch(/ORDER BY st\.workflow_order/);
        });

        it('deve prefixar as colunas da view para o JOIN não ficar ambíguo', () => {
            const sql = sqlGetPaymentByLauncher();
            expect(sql).toContain('v.id_status_fk IN (1, 2, 3, 6)');
            expect(sql).toContain('v.launched_by = @launched_by');
        });

        it('não deve expor valores monetários', () => {
            const sql = sqlGetPaymentByLauncher();
            for (const coluna of ['month_salary', 'normal_payment', 'total_payment']) {
                expect(sql).not.toContain(coluna);
            }
        });
    });

    describe('getPaymentByLauncher', () => {
        it('should query without requiring branch or cost center', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });

            await useCases.getPaymentByLauncher(148);

            // Diferente das outras filas: launched_by sozinho já restringe o conjunto.
            expect(repository.findPaymentByLauncher).toHaveBeenCalledWith(
                148, { branch: null, costCenter: null },
            );
        });

        it('should coerce a numeric string id', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });

            await useCases.getPaymentByLauncher('148');

            expect(repository.findPaymentByLauncher).toHaveBeenCalledWith(148, expect.anything());
        });

        it('should combine the launcher with the branch filter', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });

            await useCases.getPaymentByLauncher(148, { branch: ' 0209 ', costCenter: '' });

            expect(repository.findPaymentByLauncher).toHaveBeenCalledWith(
                148, { branch: '0209', costCenter: null },
            );
        });

        it.each([
            ['undefined', undefined],
            ['null', null],
            ['zero', 0],
            ['negative', -5],
            ['non-numeric', 'abc'],
        ])('should throw 400 for a %s launcher id', async (_label, value) => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });

            await expect(useCases.getPaymentByLauncher(value)).rejects.toMatchObject({ statusCode: 400 });
            expect(repository.findPaymentByLauncher).not.toHaveBeenCalled();
        });
    });

    describe('approveWorkSchedules', () => {
        it('should move a schedule awaiting approval to the payroll queue', async () => {
            const repository = makeFakeRepository({
                findWorkSchedulesStatus: jest.fn().mockResolvedValue([status('A', 2)]),
            });
            const useCases = makeUseCases({ repository });

            const result = await useCases.approveWorkSchedules(['A']);

            expect(result.approved).toEqual(['A']);
            expect(result.skipped).toEqual([]);
            expect(repository.approveWorkSchedules).toHaveBeenCalledWith(['A'], 2, 3, {
                actor: null,
                source: 'BACKEND',
                reason: CHANGE_REASON.APPROVED_BY_MANAGER,
            });
        });

        it.each([
            ['open', 1],
            ['already awaiting payroll', 3],
            ['finished', 4],
            ['cancelled', 5],
        ])('should refuse to approve a schedule that is %s', async (_label, currentStatus) => {
            const repository = makeFakeRepository({
                findWorkSchedulesStatus: jest.fn().mockResolvedValue([status('A', currentStatus)]),
            });
            const useCases = makeUseCases({ repository });

            const result = await useCases.approveWorkSchedules(['A']);

            expect(result.approved).toEqual([]);
            expect(result.skipped).toEqual([
                { cod_work_schedule: 'A', status: currentStatus, reason: 'invalid_status' },
            ]);
            expect(repository.approveWorkSchedules).not.toHaveBeenCalled();
        });

        it('should report a schedule that does not exist as not_found', async () => {
            const repository = makeFakeRepository({
                findWorkSchedulesStatus: jest.fn().mockResolvedValue([]),
            });
            const useCases = makeUseCases({ repository });

            const result = await useCases.approveWorkSchedules(['GHOST']);

            expect(result.approved).toEqual([]);
            expect(result.skipped).toEqual([
                { cod_work_schedule: 'GHOST', status: null, reason: 'not_found' },
            ]);
        });

        it('should approve only the eligible ones in a mixed batch', async () => {
            const repository = makeFakeRepository({
                findWorkSchedulesStatus: jest.fn().mockResolvedValue([
                    status('A', 2), status('B', 4), status('C', 2),
                ]),
            });
            const useCases = makeUseCases({ repository });

            const result = await useCases.approveWorkSchedules(['A', 'B', 'C']);

            expect(result.approved).toEqual(['A', 'C']);
            expect(result.skipped).toHaveLength(1);
            // A jornada já finalizada não pode entrar no UPDATE.
            expect(repository.approveWorkSchedules).toHaveBeenCalledWith(['A', 'C'], 2, 3, {
                actor: null,
                source: 'BACKEND',
                reason: CHANGE_REASON.APPROVED_BY_MANAGER,
            });
        });

        it('should accept a comma-separated string of schedules', async () => {
            const repository = makeFakeRepository({
                findWorkSchedulesStatus: jest.fn().mockResolvedValue([status('A', 2), status('B', 2)]),
            });
            const useCases = makeUseCases({ repository });

            const result = await useCases.approveWorkSchedules('A,B');

            expect(result.approved).toEqual(['A', 'B']);
        });

        it('should throw 400 when the list is empty', async () => {
            const useCases = makeUseCases();
            await expect(useCases.approveWorkSchedules([])).rejects.toThrow(AppError);
        });
    });

    describe('cancelWorkSchedule', () => {
        it.each([
            ['open', 1],
            ['awaiting approval', 2],
        ])('should discard a schedule that is %s', async (_label, currentStatus) => {
            const repository = makeFakeRepository({
                findWorkSchedulesStatus: jest.fn().mockResolvedValue([status('A', currentStatus)]),
            });
            const useCases = makeUseCases({ repository });

            await useCases.cancelWorkSchedule('A');

            expect(repository.cancelWorkSchedule).toHaveBeenCalledWith('A', [1, 2], null);
        });

        it.each([
            ['awaiting payroll', 3],
            ['finished', 4],
            ['cancelled', 5],
        ])('should refuse to discard a schedule that is %s', async (_label, currentStatus) => {
            const repository = makeFakeRepository({
                findWorkSchedulesStatus: jest.fn().mockResolvedValue([status('A', currentStatus)]),
            });
            const useCases = makeUseCases({ repository });

            // Cancelar uma jornada já finalizada apagaria um pagamento fechado.
            await expect(useCases.cancelWorkSchedule('A')).rejects.toThrow(AppError);
            expect(repository.cancelWorkSchedule).not.toHaveBeenCalled();
        });

        it('should throw 404 when the schedule does not exist', async () => {
            const repository = makeFakeRepository({
                findWorkSchedulesStatus: jest.fn().mockResolvedValue([]),
            });
            const useCases = makeUseCases({ repository });

            await expect(useCases.cancelWorkSchedule('GHOST')).rejects.toThrow(AppError);
            expect(repository.cancelWorkSchedule).not.toHaveBeenCalled();
        });

        it('should let the payroll list reach an approved schedule', async () => {
            const repository = makeFakeRepository({
                findWorkSchedulesStatus: jest.fn().mockResolvedValue([status('A', 3)]),
            });
            const useCases = makeUseCases({ repository });

            // O RH estorna a jornada aprovada antes de ela virar recibo.
            await useCases.cancelWorkSchedule('A', [1, 2, 3]);

            expect(repository.cancelWorkSchedule).toHaveBeenCalledWith('A', [1, 2, 3], null);
        });

        it('should still refuse an approved schedule with the default list', async () => {
            const repository = makeFakeRepository({
                findWorkSchedulesStatus: jest.fn().mockResolvedValue([status('A', 3)]),
            });
            const useCases = makeUseCases({ repository });

            // Encarregado e gerente não alcançam o que já foi aprovado.
            await expect(useCases.cancelWorkSchedule('A')).rejects.toMatchObject({ statusCode: 409 });
            expect(repository.cancelWorkSchedule).not.toHaveBeenCalled();
        });

        it('should refuse a finished schedule even for payroll', async () => {
            const repository = makeFakeRepository({
                findWorkSchedulesStatus: jest.fn().mockResolvedValue([status('A', 4)]),
            });
            const useCases = makeUseCases({ repository });

            // Status 4 já gerou recibo: cancelar sem estornar deixaria órfão.
            await expect(useCases.cancelWorkSchedule('A', [1, 2, 3])).rejects.toMatchObject({ statusCode: 409 });
            expect(repository.cancelWorkSchedule).not.toHaveBeenCalled();
        });

        it('should pass the allowed list through to the repository', async () => {
            const repository = makeFakeRepository({
                findWorkSchedulesStatus: jest.fn().mockResolvedValue([status('A', 2)]),
            });
            const useCases = makeUseCases({ repository });

            // A lista precisa chegar ao UPDATE — é lá que a regra é garantida.
            await useCases.cancelWorkSchedule('A');

            expect(repository.cancelWorkSchedule).toHaveBeenCalledWith('A', [1, 2], null);
        });

        it('should throw 409 when the status changes between the check and the update', async () => {
            // Passa na validação (status 2) mas o UPDATE não afeta nada: alguém
            // aprovou a jornada nesse intervalo. Sem isto, respondia sucesso.
            const repository = makeFakeRepository({
                findWorkSchedulesStatus: jest.fn().mockResolvedValue([status('A', 2)]),
                cancelWorkSchedule: jest.fn().mockResolvedValue(0),
            });
            const useCases = makeUseCases({ repository });

            await expect(useCases.cancelWorkSchedule('A')).rejects.toMatchObject({ statusCode: 409 });
        });
    });

    describe('closeWorkSchedules', () => {
        it('should skip a schedule that already has a receipt', async () => {
            const repository = makeFakeRepository({ hasExistingReceipt: jest.fn().mockResolvedValue(true) });
            const useCases = makeUseCases({ repository });
            const results = await useCases.closeWorkSchedules(['WS1'], 68, '0209');
            expect(results).toEqual([{ cod_work_schedule: 'WS1', status: 'skipped', reason: 'Recibo já gerado para esta jornada.' }]);
            expect(repository.findWorkScheduleData).not.toHaveBeenCalled();
        });

        // Estes quatro casos deixaram de lançar em 08/2026: a falha de uma jornada
        // não pode abortar o lote, então vira `failed` no resultado e a jornada é
        // devolvida à fila do RH.
        it.each([
            ['jornada não encontrada', { findWorkScheduleData: jest.fn().mockResolvedValue(null) }],
            ['sem registro de entrada', { findTimeRecordsForValidation: jest.fn().mockResolvedValue([{ id_record_type_fk: 4 }]) }],
            ['sem referência YYYYMM', { findWorkScheduleReference: jest.fn().mockResolvedValue({ reference: null, work_date: null }) }],
            ['sem valores de pagamento', { findPaymentDataByCodWork: jest.fn().mockResolvedValue(null) }],
        ])('deve reportar %s como failed, sem lançar', async (_label, overrides) => {
            const repository = makeFakeRepository(overrides);
            const useCases = makeUseCases({ repository });

            const [result] = await useCases.closeWorkSchedules(['WS1'], 68, '0209');

            expect(result).toMatchObject({
                cod_work_schedule: 'WS1',
                status: 'failed',
                reverted_to_payroll_queue: true,
            });
            expect(result.reason).toBeTruthy();
            expect(repository.insertReceiptItem).not.toHaveBeenCalled();
        });

        it('should skip when every payment value is zero', async () => {
            const repository = makeFakeRepository({
                findPaymentDataByCodWork: jest.fn().mockResolvedValue({ normal_payment: 0, extra_hour_payment: 0, night_bonus_payment: 0 }),
            });
            const useCases = makeUseCases({ repository });
            const results = await useCases.closeWorkSchedules(['WS1'], 68, '0209');
            expect(results).toEqual([{ cod_work_schedule: 'WS1', status: 'skipped', reason: 'Todos os valores de pagamento são zero.' }]);
            expect(repository.insertReceiptItem).not.toHaveBeenCalled();
        });

        it('should insert receipt items and report the result when everything checks out', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            const results = await useCases.closeWorkSchedules(['WS1'], 68, '0209');
            expect(repository.insertReceiptItem).toHaveBeenCalledTimes(1); // só normal_payment > 0
            expect(results[0].status).toBe('inserted');
            expect(results[0].items).toBe(1);
        });

        it('should accept a comma-separated string of schedules', async () => {
            const repository = makeFakeRepository({ hasExistingReceipt: jest.fn().mockResolvedValue(true) });
            const useCases = makeUseCases({ repository });
            const results = await useCases.closeWorkSchedules('WS1, WS2', 68, '0209');
            expect(results).toHaveLength(2);
            expect(results.map(r => r.cod_work_schedule)).toEqual(['WS1', 'WS2']);
        });
    });

    describe('closeWorkSchedules — isolamento de falha', () => {
        it('não deve deixar uma jornada com problema derrubar as outras do lote', async () => {
            // Era o bug: o throw abortava o loop e as jornadas seguintes ficavam
            // em status 4 sem recibo, porque a procedure já havia commitado.
            const repository = makeFakeRepository({
                findWorkScheduleData: jest.fn()
                    .mockResolvedValueOnce(WS)      // A: ok
                    .mockResolvedValueOnce(null)    // B: quebra
                    .mockResolvedValueOnce(WS),     // C: ok
            });
            const useCases = makeUseCases({ repository });

            const results = await useCases.closeWorkSchedules(['A', 'B', 'C'], 1, '0203');

            expect(results.map(r => r.status)).toEqual(['inserted', 'failed', 'inserted']);
            expect(repository.insertReceiptItem).toHaveBeenCalled();
        });

        it('deve devolver a jornada que falhou para a fila do RH (6 → 3)', async () => {
            const repository = makeFakeRepository({
                findWorkScheduleData: jest.fn().mockResolvedValue(null),
            });
            const useCases = makeUseCases({ repository });

            const [result] = await useCases.closeWorkSchedules(['A'], 1, '0203');

            // Volta para 3, não para 2: a aprovação do gerente segue válida,
            // o que falhou foi a etapa do RH.
            expect(repository.revertToPayrollQueue).toHaveBeenCalledWith('A', null);
            expect(result).toMatchObject({ status: 'failed', reverted_to_payroll_queue: true });
        });

        it('deve reportar a jornada mesmo se a própria reversão falhar', async () => {
            const repository = makeFakeRepository({
                findWorkScheduleData: jest.fn().mockResolvedValue(null),
                revertToPayrollQueue: jest.fn().mockRejectedValue(new Error('banco fora')),
            });
            const useCases = makeUseCases({ repository });

            const [result] = await useCases.closeWorkSchedules(['A'], 1, '0203');

            expect(result).toMatchObject({ status: 'failed', reverted_to_payroll_queue: false });
        });

        it('não deve reverter jornada apenas ignorada', async () => {
            const repository = makeFakeRepository({
                hasExistingReceipt: jest.fn().mockResolvedValue(true),
            });
            const useCases = makeUseCases({ repository });

            const [result] = await useCases.closeWorkSchedules(['A'], 1, '0203');

            expect(result.status).toBe('skipped');
            expect(repository.revertToPayrollQueue).not.toHaveBeenCalled();
        });
    });

    describe('processWorkSchedules — approval gate', () => {
        it.each([
            ['open', 1],
            ['awaiting manager approval', 2],
            ['already finished', 4],
            ['cancelled', 5],
        ])('should refuse to process a schedule that is %s', async (_label, currentStatus) => {
            const repository = makeFakeRepository({
                findWorkSchedulesStatus: jest.fn().mockResolvedValue([status('A', currentStatus)]),
            });
            const useCases = makeUseCases({ repository });

            // Finalizar sem passar pelo gerente geraria pagamento não aprovado.
            await expect(useCases.processWorkSchedules(['A'], 1, '0203')).rejects.toThrow(AppError);
            expect(repository.processWorkSchedules).not.toHaveBeenCalled();
        });

        it('should process only the approved ones and report the rest', async () => {
            const repository = makeFakeRepository({
                findWorkSchedulesStatus: jest.fn().mockResolvedValue([
                    status('A', 3), status('B', 2),
                ]),
            });
            const useCases = makeUseCases({ repository });

            const result = await useCases.processWorkSchedules(['A', 'B'], 1, '0203');

            expect(repository.processWorkSchedules).toHaveBeenCalledWith('A', null);
            expect(result.rejected).toEqual([
                { cod_work_schedule: 'B', status: 2, reason: 'not_approved' },
            ]);
        });

        it('should throw 409 when nothing in the list is approved', async () => {
            const repository = makeFakeRepository({
                findWorkSchedulesStatus: jest.fn().mockResolvedValue([status('A', 2)]),
            });
            const useCases = makeUseCases({ repository });

            await expect(useCases.processWorkSchedules(['A'], 1, '0203')).rejects.toMatchObject({ statusCode: 409 });
        });
    });

    describe('processWorkSchedules', () => {
        it('should throw 404 when no payment data is found after processing', async () => {
            const repository = makeFakeRepository({
                findPaymentsForReplication: jest.fn().mockResolvedValue([]),
            });
            const useCases = makeUseCases({ repository });
            await expect(useCases.processWorkSchedules(['WS1'], '068', '0209')).rejects.toThrow(AppError);
        });

        // A procedure já commitou o 3 → 6 quando estes passos rodam. Sem a
        // reversão a jornada ficava em 6 sem recibo, estado que a interface não
        // corrige — era o que obrigava a reprocessar recibo direto no banco.
        it('should send the batch back to the payroll queue when there is no payment data', async () => {
            const repository = makeFakeRepository({
                findPaymentsForReplication: jest.fn().mockResolvedValue([]),
            });
            const useCases = makeUseCases({ repository });

            await expect(useCases.processWorkSchedules(['WS1', 'WS2'], '068', '0209')).rejects.toMatchObject({
                statusCode: 404,
                code: 'NO_PAYMENT_DATA',
                details: { reverted_to_payroll_queue: ['WS1', 'WS2'] },
            });

            expect(repository.revertToPayrollQueue).toHaveBeenCalledWith('WS1', null);
            expect(repository.revertToPayrollQueue).toHaveBeenCalledWith('WS2', null);
        });

        it('should send the batch back to the payroll queue when replication fails', async () => {
            const repository = makeFakeRepository();
            const replicationRepository = makeFakeReplicationRepository({
                replicatePayment: jest.fn().mockRejectedValue(new Error('replicacao fora do ar')),
            });
            const useCases = makeUseCases({ repository, replicationRepository });

            await expect(useCases.processWorkSchedules(['WS1'], '068', '0209'))
                .rejects.toMatchObject({ details: { reverted_to_payroll_queue: ['WS1'] } });

            expect(repository.revertToPayrollQueue).toHaveBeenCalledWith('WS1', null);
        });

        it('should report the schedule as stuck when the revert itself fails', async () => {
            const repository = makeFakeRepository({
                findPaymentsForReplication: jest.fn().mockResolvedValue([]),
                revertToPayrollQueue: jest.fn().mockRejectedValue(new Error('banco fora')),
            });
            const useCases = makeUseCases({ repository });

            await expect(useCases.processWorkSchedules(['WS1'], '068', '0209'))
                .rejects.toMatchObject({ details: { reverted_to_payroll_queue: [] } });
        });

        // Uma pessoa com cadastro pendente no MySQL travava o fechamento de todas
        // as outras da mesma leva. Agora ela é pulada e o lote segue.
        it('should skip the person missing from MySQL instead of failing the batch', async () => {
            const repository = makeFakeRepository({
                findPaymentsForReplication: jest.fn().mockResolvedValue([
                    { cod_work_schedule: 'WS1', cpf: '111' },
                    { cod_work_schedule: 'WS2', cpf: '222' },
                ]),
            });
            const naoEncontrado = new AppError('CPF sem contrato ativo.', 422, {
                code: 'MYSQL_EMPLOYEE_NOT_FOUND',
            });
            const replicationRepository = makeFakeReplicationRepository({
                replicatePayment: jest.fn()
                    .mockRejectedValueOnce(naoEncontrado)
                    .mockResolvedValueOnce(undefined),
            });
            const useCases = makeUseCases({ repository, replicationRepository });

            const result = await useCases.processWorkSchedules(['WS1', 'WS2'], '068', '0209');

            expect(result.replication_skipped).toEqual([
                { cod_work_schedule: 'WS1', cpf: '111', reason: 'employee_not_found_in_mysql' },
            ]);
            // A segunda continuou, e nada foi devolvido para a fila do RH.
            expect(replicationRepository.replicatePayment).toHaveBeenCalledTimes(2);
            expect(repository.revertToPayrollQueue).not.toHaveBeenCalled();
            expect(result.closing).toBeDefined();
        });

        // Pular aqui geraria recibo sem contrapartida no MySQL, e a divergência
        // passaria em silêncio justamente no caso mais grave.
        it('should still abort the batch when MySQL itself fails', async () => {
            const repository = makeFakeRepository({
                findPaymentsForReplication: jest.fn().mockResolvedValue([
                    { cod_work_schedule: 'WS1', cpf: '111' },
                    { cod_work_schedule: 'WS2', cpf: '222' },
                ]),
            });
            const replicationRepository = makeFakeReplicationRepository({
                replicatePayment: jest.fn().mockRejectedValue(
                    new AppError('MySQL fora do ar.', 500, { code: 'MYSQL_GIPP_ERROR' })
                ),
            });
            const useCases = makeUseCases({ repository, replicationRepository });

            await expect(useCases.processWorkSchedules(['WS1', 'WS2'], '068', '0209'))
                .rejects.toMatchObject({
                    code: 'MYSQL_GIPP_ERROR',
                    details: { reverted_to_payroll_queue: ['WS1', 'WS2'] },
                });

            // Parou no primeiro: não insiste com o banco fora do ar.
            expect(replicationRepository.replicatePayment).toHaveBeenCalledTimes(1);
        });

        it('should report an empty skip list when everything replicates', async () => {
            const useCases = makeUseCases();
            const result = await useCases.processWorkSchedules(['WS1'], '068', '0209');
            expect(result.replication_skipped).toEqual([]);
        });

        it('should not revert anything when processing succeeds', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });

            await useCases.processWorkSchedules(['WS1'], '068', '0209');

            expect(repository.revertToPayrollQueue).not.toHaveBeenCalled();
        });

        it('should replicate each payment and then close the schedules', async () => {
            const repository = makeFakeRepository();
            const replicationRepository = makeFakeReplicationRepository();
            const useCases = makeUseCases({ repository, replicationRepository });

            const result = await useCases.processWorkSchedules(['WS1'], '068', '0209');

            expect(repository.processWorkSchedules).toHaveBeenCalledWith('WS1', null);
            expect(replicationRepository.replicatePayment).toHaveBeenCalledWith({ cpf: '111' });
            expect(result.payments).toEqual([{ cpf: '111' }]);
            expect(result.closing[0].status).toBe('inserted');
        });
    });
});
