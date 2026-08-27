const { PayeeUseCases } = require('../payee.use-cases');
const { PayeeRepositoryPort } = require('../ports/payee-repository.port');
const { AppError } = require('../../../../../errors/app.error');

function makeFakeRepository(overrides = {}) {
    const repo = new PayeeRepositoryPort();
    repo.findAll = jest.fn().mockResolvedValue([{ id: 1, name: 'Fulano' }]);
    repo.insert = jest.fn().mockResolvedValue({ id: 1, name: 'Fulano' });
    repo.update = jest.fn().mockResolvedValue({ id: 1, name: 'Fulano Atualizado' });
    repo.patch = jest.fn().mockResolvedValue({ id: 1, name: 'Fulano' });
    repo.exists = jest.fn().mockResolvedValue(true);
    repo.hasActiveReceipts = jest.fn().mockResolvedValue(false);
    repo.remove = jest.fn().mockResolvedValue();
    return Object.assign(repo, overrides);
}

function makeUseCases({ repository } = {}) {
    return new PayeeUseCases({ repository: repository ?? makeFakeRepository() });
}

describe('PayeeUseCases', () => {
    describe('replacePayee', () => {
        it('should throw 404 when the payee does not exist', async () => {
            const repository = makeFakeRepository({ update: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.replacePayee({ id: 999 })).rejects.toThrow(AppError);
        });
    });

    describe('patchPayee', () => {
        it('should throw 400 when no fields are provided', async () => {
            const useCases = makeUseCases();
            await expect(useCases.patchPayee(1, {}, 'user1', '01')).rejects.toThrow(AppError);
        });

        it('should throw 404 when the payee does not exist', async () => {
            const repository = makeFakeRepository({ patch: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.patchPayee(999, { name: 'X' }, 'user1', '01')).rejects.toThrow(AppError);
        });

        it('should delegate to the repository with the given fields', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.patchPayee(1, { name: 'Novo Nome' }, 'user1', '01');
            expect(repository.patch).toHaveBeenCalledWith(1, { name: 'Novo Nome' }, 'user1', '01');
        });
    });

    describe('deletePayee', () => {
        it('should throw 404 when the payee does not exist', async () => {
            const repository = makeFakeRepository({ exists: jest.fn().mockResolvedValue(false) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.deletePayee(999)).rejects.toThrow(AppError);
            expect(repository.remove).not.toHaveBeenCalled();
        });

        it('should throw 409 when there are linked active payment receipts', async () => {
            const repository = makeFakeRepository({ hasActiveReceipts: jest.fn().mockResolvedValue(true) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.deletePayee(1)).rejects.toThrow(AppError);
            expect(repository.remove).not.toHaveBeenCalled();
        });

        it('should delete when the payee exists and has no linked receipts', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            const result = await useCases.deletePayee(1);
            expect(repository.remove).toHaveBeenCalledWith(1);
            expect(result).toEqual({ deleted: true });
        });
    });
});
