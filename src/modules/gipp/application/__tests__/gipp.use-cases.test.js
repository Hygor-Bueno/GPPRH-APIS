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
    repo.findRecordTypes = jest.fn().mockResolvedValue([{ id: 1 }]);
    repo.findTimeRecordsByCodWork = jest.fn().mockResolvedValue([{ id: 1 }]);
    repo.findTimeRecords = jest.fn().mockResolvedValue([{ id: 1 }]);
    repo.insertTimeRecord = jest.fn().mockResolvedValue([{ id: 1 }]);
    repo.updateTimeRecord = jest.fn().mockResolvedValue([{ id: 1 }]);
    repo.cancelWorkSchedule = jest.fn().mockResolvedValue();
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

    describe('processWorkSchedules', () => {
        it('should throw 404 when no payment data is found after processing', async () => {
            const repository = makeFakeRepository({ findPaymentsForReplication: jest.fn().mockResolvedValue([]) });
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
