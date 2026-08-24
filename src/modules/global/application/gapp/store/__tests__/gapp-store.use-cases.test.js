const { GappStoreUseCases } = require('../gapp-store.use-cases');
const { StoreRepositoryPort } = require('../ports/store-repository.port');
const { AppError } = require('../../../../../../errors/app.error');

function makeFakeRepository(overrides = {}) {
    const repo = new StoreRepositoryPort();
    repo.list = jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    repo.findById = jest.fn().mockResolvedValue({ store_id: 1, name: 'Loja Centro' });
    repo.storeExists = jest.fn().mockResolvedValue(true);
    repo.insert = jest.fn().mockResolvedValue({ insertId: 1 });
    repo.update = jest.fn().mockResolvedValue({ updated: 1 });
    repo.softDeleteStore = jest.fn().mockResolvedValue(undefined);
    return Object.assign(repo, overrides);
}

describe('GappStoreUseCases', () => {
    describe('listStores', () => {
        it('should delegate filters to the repository', async () => {
            const repository = makeFakeRepository();
            const useCases = new GappStoreUseCases({ repository });

            await useCases.listStores({ city: 'São Paulo' });

            expect(repository.list).toHaveBeenCalledWith({ city: 'São Paulo' });
        });
    });

    describe('getStoreById', () => {
        it('should throw 404 when not found', async () => {
            const repository = makeFakeRepository({ findById: jest.fn().mockResolvedValue(null) });
            const useCases = new GappStoreUseCases({ repository });

            await expect(useCases.getStoreById(999)).rejects.toThrow(AppError);
        });

        it('should return the store when found', async () => {
            const repository = makeFakeRepository();
            const useCases = new GappStoreUseCases({ repository });

            const result = await useCases.getStoreById(1);

            expect(result).toEqual({ store_id: 1, name: 'Loja Centro' });
        });
    });

    describe('createStore', () => {
        it('should insert then refetch by the inserted id', async () => {
            const repository = makeFakeRepository();
            const useCases = new GappStoreUseCases({ repository });

            const result = await useCases.createStore({ name: 'Loja Centro' });

            expect(repository.insert).toHaveBeenCalledWith({ name: 'Loja Centro' });
            expect(repository.findById).toHaveBeenCalledWith(1);
            expect(result).toEqual({ store_id: 1, name: 'Loja Centro' });
        });
    });

    describe('updateStore', () => {
        it('should throw 404 when the store does not exist, without updating', async () => {
            const repository = makeFakeRepository({ storeExists: jest.fn().mockResolvedValue(false) });
            const useCases = new GappStoreUseCases({ repository });

            await expect(useCases.updateStore(999, { name: 'X' })).rejects.toThrow(AppError);
            expect(repository.update).not.toHaveBeenCalled();
        });

        it('should update then refetch when the store exists', async () => {
            const repository = makeFakeRepository();
            const useCases = new GappStoreUseCases({ repository });

            const result = await useCases.updateStore(1, { name: 'Loja Centro' });

            expect(repository.update).toHaveBeenCalledWith(1, { name: 'Loja Centro' });
            expect(result).toEqual({ store_id: 1, name: 'Loja Centro' });
        });
    });

    describe('deleteStore', () => {
        it('should throw 404 when the store does not exist', async () => {
            const repository = makeFakeRepository({ storeExists: jest.fn().mockResolvedValue(false) });
            const useCases = new GappStoreUseCases({ repository });

            await expect(useCases.deleteStore(999)).rejects.toThrow(AppError);
            expect(repository.softDeleteStore).not.toHaveBeenCalled();
        });

        it('should soft-delete (never hard-delete) when the store exists', async () => {
            const repository = makeFakeRepository();
            const useCases = new GappStoreUseCases({ repository });

            const result = await useCases.deleteStore(1);

            expect(repository.softDeleteStore).toHaveBeenCalledWith(1);
            expect(result).toEqual({ deleted: true });
        });
    });
});
