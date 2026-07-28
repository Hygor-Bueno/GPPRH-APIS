const { ShopUseCases } = require('../shop.use-cases');
const { ShopRepositoryPort } = require('../ports/shop-repository.port');
const { ShopExternalSourceRepositoryPort } = require('../ports/shop-external-source-repository.port');
const { AppError } = require('../../../../../errors/app.error');

function makeFakeRepository(overrides = {}) {
    const repo = new ShopRepositoryPort();
    repo.findAll = jest.fn().mockResolvedValue([{ id: 1, number: '01', description: 'Loja 1', cnpj: '111' }]);
    repo.findAllWithCodes = jest.fn().mockResolvedValue([
        { shop_id: 1, number: '01', description: 'Loja 1', cnpj: '111', system_name: 'c5', code: 'C5-1' },
    ]);
    return Object.assign(repo, overrides);
}

function makeFakeExternalSource(overrides = {}) {
    const source = new ShopExternalSourceRepositoryPort();
    source.findAll = jest.fn().mockResolvedValue([{ code: 'P-1', description: 'Loja 1', cnpj: '111' }]);
    return Object.assign(source, overrides);
}

function makeUseCases({ repository, protheus, consinco } = {}) {
    return new ShopUseCases({
        repository: repository ?? makeFakeRepository(),
        externalSources: {
            protheus: protheus ?? makeFakeExternalSource(),
            consinco: consinco ?? makeFakeExternalSource(),
        },
    });
}

describe('ShopUseCases', () => {
    describe('getShops', () => {
        it('should delegate to the repository with the given companyId', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.getShops(7);
            expect(repository.findAll).toHaveBeenCalledWith(7);
        });

        it('should default companyId to null', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.getShops();
            expect(repository.findAll).toHaveBeenCalledWith(null);
        });
    });

    describe('getAudit', () => {
        it('should throw 400 for an invalid source', async () => {
            const useCases = makeUseCases();
            await expect(useCases.getAudit('invalid')).rejects.toThrow(AppError);
        });

        it('should query the matching external source only', async () => {
            const protheus = makeFakeExternalSource();
            const consinco = makeFakeExternalSource();
            const useCases = makeUseCases({ protheus, consinco });

            await useCases.getAudit('protheus');

            expect(protheus.findAll).toHaveBeenCalledTimes(1);
            expect(consinco.findAll).not.toHaveBeenCalled();
        });

        it('should merge mysql and external data by cnpj', async () => {
            const useCases = makeUseCases();
            const result = await useCases.getAudit('protheus');
            expect(result).toEqual([{
                cnpj: '111', description: 'Loja 1', in_mysql: true, shop_id: 1,
                systems: { c5: 'C5-1', protheus: 'P-1', consinco: null },
            }]);
        });
    });
});
