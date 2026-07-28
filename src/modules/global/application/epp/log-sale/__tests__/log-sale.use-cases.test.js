const { EppLogSaleUseCases } = require('../log-sale.use-cases');
const { LogSaleRepositoryPort } = require('../ports/log-sale-repository.port');
const { OracleEppRepositoryPort } = require('../../ports/oracle-epp-repository.port');
const { AppError } = require('../../../../../../errors/app.error');

function makeFakeRepository(overrides = {}) {
    const repo = new LogSaleRepositoryPort();
    repo.findLogSales = jest.fn().mockResolvedValue([]);
    repo.findLogSalesByOrder = jest.fn().mockResolvedValue([]);
    repo.findControllerView = jest.fn().mockResolvedValue([]);
    repo.findReceipeEpp = jest.fn().mockResolvedValue([]);
    repo.findReceipeEppFiltered = jest.fn().mockResolvedValue([]);
    repo.orderExists = jest.fn().mockResolvedValue(true);
    repo.insertLogSale = jest.fn().mockResolvedValue({ insertId: 1 });
    repo.findLogSaleById = jest.fn().mockResolvedValue({ epp_id_log: 1 });
    repo.updateLogSale = jest.fn().mockResolvedValue({ updated: 1 });
    repo.deleteLogSaleById = jest.fn().mockResolvedValue({ deleted: 1 });
    repo.deleteLogSaleByOrder = jest.fn().mockResolvedValue({ deleted: 3 });
    return Object.assign(repo, overrides);
}

function makeFakeOracleRepository(overrides = {}) {
    const repo = new OracleEppRepositoryPort();
    repo.getReceipeByProduct = jest.fn().mockResolvedValue([]);
    repo.getReceipeByProducts = jest.fn().mockResolvedValue([]);
    repo.getProductDescriptions = jest.fn().mockResolvedValue([]);
    return Object.assign(repo, overrides);
}

describe('EppLogSaleUseCases', () => {
    describe('createLogSale', () => {
        it('should throw 404 when order does not exist', async () => {
            const repository = makeFakeRepository({ orderExists: jest.fn().mockResolvedValue(false) });
            const useCases = new EppLogSaleUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            await expect(useCases.createLogSale({ epp_id_order: 99, epp_id_product: 1, quantity: 1, price: 1 }))
                .rejects.toThrow(AppError);
            expect(repository.insertLogSale).not.toHaveBeenCalled();
        });

        it('should insert then refetch when order exists', async () => {
            const repository = makeFakeRepository();
            const useCases = new EppLogSaleUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            const result = await useCases.createLogSale({ epp_id_order: 1, epp_id_product: 1, quantity: 1, price: 1 });

            expect(repository.insertLogSale).toHaveBeenCalled();
            expect(result).toEqual({ epp_id_log: 1 });
        });
    });

    describe('getMobileView', () => {
        it('should return an empty array when there are no pending rows', async () => {
            const repository = makeFakeRepository({ findReceipeEpp: jest.fn().mockResolvedValue([]) });
            const useCases = new EppLogSaleUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            expect(await useCases.getMobileView()).toEqual([]);
        });

        it('should orchestrate MySQL + Oracle and use the real calculator to combine results', async () => {
            const repository = makeFakeRepository({
                findReceipeEpp: jest.fn().mockResolvedValue([
                    { epp_id_product: 1, quantity: '5', menu: 0 },
                    { epp_id_product: 10, quantity: '2', menu: 1 },
                ])
            });
            const oracleRepository = makeFakeOracleRepository({
                getReceipeByProducts: jest.fn().mockResolvedValue([
                    { COD_PROD_FINAL: 10, COD_PROD_MAT_PRIMA: 2, QTDUNIDUTILIZADA: '3', DESCRICAO_MAT_PRIMA: 'Feijão' }
                ]),
                getProductDescriptions: jest.fn().mockResolvedValue([{ SEQPRODUTO: 1, PRODUTO: 'Arroz' }])
            });
            const useCases = new EppLogSaleUseCases({ repository, oracleRepository });

            const result = await useCases.getMobileView();

            expect(oracleRepository.getReceipeByProducts).toHaveBeenCalledWith([10]);
            expect(oracleRepository.getProductDescriptions).toHaveBeenCalledWith([1]);
            expect(result).toEqual(expect.arrayContaining([
                { epp_id_product: 1, quantity: 5, menu: 0, description: 'Arroz' },
                { epp_id_product: 2, quantity: 6, menu: 0, description: 'Feijão' }, // 3 * quantity(2)
            ]));
        });

        it('should use findReceipeEppFiltered when filters are provided', async () => {
            const repository = makeFakeRepository({
                findReceipeEppFiltered: jest.fn().mockResolvedValue([{ epp_id_product: 1, quantity: '1', menu: 0 }])
            });
            const useCases = new EppLogSaleUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            await useCases.getMobileView({ store: 'Interlagos_1' });

            expect(repository.findReceipeEppFiltered).toHaveBeenCalledWith(expect.objectContaining({ store: 'Interlagos' }));
            expect(repository.findReceipeEpp).not.toHaveBeenCalled();
        });
    });
});
