const { GippUseCases } = require('../gipp.use-cases');
const { GippRepositoryPort } = require('../ports/gipp-repository.port');
const { GippReplicationRepositoryPort } = require('../ports/gipp-replication-repository.port');
const { AppError } = require('../../../../errors/app.error');

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
            expect(repository.approveWorkSchedules).toHaveBeenCalledWith(['A'], 2, 3);
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
            expect(repository.approveWorkSchedules).toHaveBeenCalledWith(['A', 'C'], 2, 3);
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

            expect(repository.cancelWorkSchedule).toHaveBeenCalledWith('A');
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

        it('should throw 404 when the work schedule is not found', async () => {
            const repository = makeFakeRepository({ findWorkScheduleData: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.closeWorkSchedules(['WS1'], 68, '0209')).rejects.toThrow(AppError);
        });

        it('should throw 422 when time records are invalid (no entry)', async () => {
            const repository = makeFakeRepository({ findTimeRecordsForValidation: jest.fn().mockResolvedValue([{ id_record_type_fk: 4 }]) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.closeWorkSchedules(['WS1'], 68, '0209')).rejects.toThrow(AppError);
        });

        it('should throw 422 when no reference can be determined', async () => {
            const repository = makeFakeRepository({ findWorkScheduleReference: jest.fn().mockResolvedValue({ reference: null, work_date: null }) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.closeWorkSchedules(['WS1'], 68, '0209')).rejects.toThrow(AppError);
        });

        it('should throw 422 when payment data is missing', async () => {
            const repository = makeFakeRepository({ findPaymentDataByCodWork: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.closeWorkSchedules(['WS1'], 68, '0209')).rejects.toThrow(AppError);
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

            expect(repository.processWorkSchedules).toHaveBeenCalledWith('A');
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

        it('should replicate each payment and then close the schedules', async () => {
            const repository = makeFakeRepository();
            const replicationRepository = makeFakeReplicationRepository();
            const useCases = makeUseCases({ repository, replicationRepository });

            const result = await useCases.processWorkSchedules(['WS1'], '068', '0209');

            expect(repository.processWorkSchedules).toHaveBeenCalledWith('WS1');
            expect(replicationRepository.replicatePayment).toHaveBeenCalledWith({ cpf: '111' });
            expect(result.payments).toEqual([{ cpf: '111' }]);
            expect(result.closing[0].status).toBe('inserted');
        });
    });
});
