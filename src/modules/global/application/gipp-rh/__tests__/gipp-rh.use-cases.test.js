const { GippRhUseCases } = require('../gipp-rh.use-cases');
const { GippRhRepositoryPort } = require('../ports/gipp-rh-repository.port');
const { AppError } = require('../../../../../errors/app.error');

function makeFakeRepository(overrides = {}) {
    const repo = new GippRhRepositoryPort();
    repo.findActiveCompensations = jest.fn().mockResolvedValue([{ id: 1, name: 'Vale Transporte' }]);
    repo.insertCompensation = jest.fn().mockResolvedValue({ id: 1, name: 'Vale Transporte' });
    repo.updateCompensation = jest.fn().mockResolvedValue({ id: 1, name: 'Vale Transporte' });

    repo.findActiveBeneficiaries = jest.fn().mockResolvedValue([{ id: 1, name: 'Fulano' }]);
    repo.upsertBeneficiary = jest.fn().mockResolvedValue({ id: 1 });

    repo.findEmployeesPaginated = jest.fn().mockResolvedValue([{ id: 1, name: 'Fulano' }]);

    repo.findReceiptData = jest.fn().mockResolvedValue([{ empresa: 'Acme' }]);
    repo.findReceiptsByGroupIds = jest.fn().mockResolvedValue([{ empresa: 'Acme' }]);

    repo.findEventCodes = jest.fn().mockResolvedValue([{ RV_COD: '01' }]);
    repo.findPaymentTypes = jest.fn().mockResolvedValue([{ id: 1, description: 'Salário' }]);

    repo.insertPaymentReceipt = jest.fn().mockResolvedValue({ id: 1 });
    repo.findPaymentReceipts = jest.fn().mockResolvedValue([{ id: 1 }]);
    repo.updatePaymentReceipt = jest.fn().mockResolvedValue({ id: 1 });
    repo.patchPaymentReceipt = jest.fn().mockResolvedValue({ id: 1 });

    repo.findReceipt = jest.fn().mockResolvedValue([{ id: 1 }]);

    return Object.assign(repo, overrides);
}

function makeUseCases({ repository } = {}) {
    return new GippRhUseCases({ repository: repository ?? makeFakeRepository() });
}

describe('GippRhUseCases', () => {
    describe('createPaymentReceipt', () => {
        it('should throw 400 when neither employee_code nor payee_id are provided', async () => {
            const useCases = makeUseCases();
            await expect(useCases.createPaymentReceipt({ description: 'x' })).rejects.toThrow(AppError);
        });

        it('should allow employee_code alone', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.createPaymentReceipt({ employee_code: '123' });
            expect(repository.insertPaymentReceipt).toHaveBeenCalled();
        });

        it('should allow payee_id alone', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.createPaymentReceipt({ payee_id: 5 });
            expect(repository.insertPaymentReceipt).toHaveBeenCalled();
        });
    });

    describe('updatePaymentReceipt', () => {
        it('should throw 404 when the receipt does not exist', async () => {
            const repository = makeFakeRepository({ updatePaymentReceipt: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.updatePaymentReceipt({ id: 999 })).rejects.toThrow(AppError);
        });
    });

    describe('patchPaymentReceipt', () => {
        it('should throw 400 when no fields are provided', async () => {
            const useCases = makeUseCases();
            await expect(useCases.patchPaymentReceipt(1, {}, 'user1', '01')).rejects.toThrow(AppError);
        });

        it('should throw 404 when the receipt does not exist', async () => {
            const repository = makeFakeRepository({ patchPaymentReceipt: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.patchPaymentReceipt(999, { amount: 10 }, 'user1', '01')).rejects.toThrow(AppError);
        });

        it('should delegate to the repository with the given fields', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.patchPaymentReceipt(1, { amount: 10 }, 'user1', '01');
            expect(repository.patchPaymentReceipt).toHaveBeenCalledWith(1, { amount: 10 }, 'user1', '01');
        });
    });

    describe('getReceiptsByGroupIds', () => {
        it('should return an empty array without querying when no group ids are given', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            const result = await useCases.getReceiptsByGroupIds([]);
            expect(result).toEqual([]);
            expect(repository.findReceiptsByGroupIds).not.toHaveBeenCalled();
        });

        it('should query when group ids are given', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.getReceiptsByGroupIds(['abc']);
            expect(repository.findReceiptsByGroupIds).toHaveBeenCalledWith(['abc']);
        });
    });

    describe('createBeneficiary / updateBeneficiary', () => {
        it('should both delegate to the same upsert operation', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.createBeneficiary({ employee_id: '1' });
            await useCases.updateBeneficiary({ id: 5, employee_id: '1' });
            expect(repository.upsertBeneficiary).toHaveBeenNthCalledWith(1, { employee_id: '1' });
            expect(repository.upsertBeneficiary).toHaveBeenNthCalledWith(2, { id: 5, employee_id: '1' });
        });
    });
});
