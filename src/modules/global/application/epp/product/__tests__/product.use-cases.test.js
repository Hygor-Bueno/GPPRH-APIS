const { EppProductUseCases } = require('../product.use-cases');
const { ProductRepositoryPort } = require('../ports/product-repository.port');
const { OracleEppRepositoryPort } = require('../../ports/oracle-epp-repository.port');
const { AppError } = require('../../../../../../errors/app.error');

function makeFakeRepository(overrides = {}) {
    const repo = new ProductRepositoryPort();
    repo.findProducts = jest.fn().mockResolvedValue([{ id_product: 1 }]);
    repo.findProductsComplete = jest.fn().mockResolvedValue([{ id_product: 1 }, { id_product: 2 }]);
    repo.findProductById = jest.fn().mockResolvedValue({ id_product: 1, description: 'Arroz' });
    repo.findCategories = jest.fn().mockResolvedValue([{ id_category: 1 }]);
    repo.searchProducts = jest.fn().mockResolvedValue([{ id_product: 1 }]);
    repo.productExists = jest.fn().mockResolvedValue(false);
    repo.insertProduct = jest.fn().mockResolvedValue(undefined);
    repo.updateProduct = jest.fn().mockResolvedValue({ updated: 1 });
    repo.changeProductStatus = jest.fn().mockResolvedValue({ updated: 1 });
    repo.hasOpenOrdersLinked = jest.fn().mockResolvedValue(false);
    repo.hasLinkedLogSale = jest.fn().mockResolvedValue(false);
    repo.deleteProduct = jest.fn().mockResolvedValue(undefined);
    return Object.assign(repo, overrides);
}

function makeFakeOracleRepository(overrides = {}) {
    const repo = new OracleEppRepositoryPort();
    repo.getProductConsinco = jest.fn().mockResolvedValue([{ SEQPRODUTO: 1 }]);
    return Object.assign(repo, overrides);
}

describe('EppProductUseCases', () => {
    describe('createProduct', () => {
        it('should throw 409 when product already exists', async () => {
            const repository = makeFakeRepository({ productExists: jest.fn().mockResolvedValue(true) });
            const useCases = new EppProductUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            await expect(useCases.createProduct({ id_product: 1, description: 'Arroz' })).rejects.toThrow(AppError);
            expect(repository.insertProduct).not.toHaveBeenCalled();
        });

        it('should insert then refetch when product does not exist', async () => {
            const repository = makeFakeRepository();
            const useCases = new EppProductUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            const result = await useCases.createProduct({ id_product: 1, description: 'Arroz' });

            expect(repository.insertProduct).toHaveBeenCalled();
            expect(result).toEqual({ id_product: 1, description: 'Arroz' });
        });
    });

    describe('updateProduct / changeProductStatus', () => {
        it('should block inactivation when linked to an open order', async () => {
            const repository = makeFakeRepository({ hasOpenOrdersLinked: jest.fn().mockResolvedValue(true) });
            const useCases = new EppProductUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            await expect(useCases.updateProduct(1, { status_prod: 0 })).rejects.toThrow(AppError);
            expect(repository.updateProduct).not.toHaveBeenCalled();
        });

        it('should not check open orders when status_prod is not 0', async () => {
            const repository = makeFakeRepository();
            const useCases = new EppProductUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            await useCases.updateProduct(1, { status_prod: 1, description: 'X' });

            expect(repository.hasOpenOrdersLinked).not.toHaveBeenCalled();
        });

        it('changeProductStatus should throw 404 when nothing updated', async () => {
            const repository = makeFakeRepository({ changeProductStatus: jest.fn().mockResolvedValue({ updated: 0 }) });
            const useCases = new EppProductUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            await expect(useCases.changeProductStatus(1, 1)).rejects.toThrow(AppError);
        });
    });

    describe('deleteProduct', () => {
        it('should throw 409 when linked to log sale', async () => {
            const repository = makeFakeRepository({
                productExists: jest.fn().mockResolvedValue(true),
                hasLinkedLogSale: jest.fn().mockResolvedValue(true),
            });
            const useCases = new EppProductUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            await expect(useCases.deleteProduct(1)).rejects.toThrow(AppError);
            expect(repository.deleteProduct).not.toHaveBeenCalled();
        });
    });

    describe('getProductConsinco', () => {
        it('should delegate to oracleRepository', async () => {
            const repository = makeFakeRepository();
            const oracleRepository = makeFakeOracleRepository();
            const useCases = new EppProductUseCases({ repository, oracleRepository });

            const result = await useCases.getProductConsinco('123', '1,2,3');

            expect(oracleRepository.getProductConsinco).toHaveBeenCalledWith('123', '1,2,3');
            expect(result).toEqual([{ SEQPRODUTO: 1 }]);
        });
    });
});
