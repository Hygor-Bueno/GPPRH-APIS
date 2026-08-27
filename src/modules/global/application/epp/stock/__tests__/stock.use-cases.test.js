const { EppStockUseCases } = require('../stock.use-cases');
const { StockRepositoryPort } = require('../ports/stock-repository.port');
const { OracleEppRepositoryPort } = require('../../ports/oracle-epp-repository.port');
const { AppError } = require('../../../../../../errors/app.error');

function makeFakeRepository(overrides = {}) {
    const repo = new StockRepositoryPort();
    repo.findStock = jest.fn().mockResolvedValue([
        { id_product_fk: 1, stock_quantity: '10', input_quantity: '10', output_quantity: '0', quantity: '2' }
    ]);
    repo.findStockByProduct = jest.fn().mockResolvedValue([{ stock_quantity: '10' }]);
    repo.findStockByIdStock = jest.fn().mockResolvedValue([{ stock_quantity: '10' }]);
    repo.findStockHistory = jest.fn().mockResolvedValue([{ id_stock: 1 }]);
    repo.countPendingProduction = jest.fn().mockResolvedValue(5);
    repo.findPendingProduction = jest.fn().mockResolvedValue([{ id_product: 1 }]);
    repo.findMenusForStock = jest.fn().mockResolvedValue([]);
    repo.stockExists = jest.fn().mockResolvedValue(true);
    repo.findStockRawById = jest.fn().mockResolvedValue({ id_stock: 1 });
    repo.insertStock = jest.fn().mockResolvedValue({ insertId: 1 });
    repo.updateStock = jest.fn().mockResolvedValue({ updated: 1 });
    return Object.assign(repo, overrides);
}

function makeFakeOracleRepository(overrides = {}) {
    const repo = new OracleEppRepositoryPort();
    repo.getRawMaterialQtyFromMenus = jest.fn().mockResolvedValue([]);
    return Object.assign(repo, overrides);
}

describe('EppStockUseCases', () => {
    describe('getStock', () => {
        it('should fetch findMenusForStock only once regardless of row count', async () => {
            const repository = makeFakeRepository({
                findStock: jest.fn().mockResolvedValue([
                    { id_product_fk: 1, stock_quantity: '10', input_quantity: '10', output_quantity: '0', quantity: '2' },
                    { id_product_fk: 2, stock_quantity: '5', input_quantity: '5', output_quantity: '0', quantity: '1' },
                    { id_product_fk: 3, stock_quantity: '1', input_quantity: '1', output_quantity: '0', quantity: '0' },
                ])
            });
            const useCases = new EppStockUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            await useCases.getStock();

            expect(repository.findMenusForStock).toHaveBeenCalledTimes(1);
        });

        it('should enrich rows with Oracle-derived menu quantity', async () => {
            const repository = makeFakeRepository({
                findMenusForStock: jest.fn().mockResolvedValue([{ epp_id_product: 1, quantity: '2' }])
            });
            const oracleRepository = makeFakeOracleRepository({
                getRawMaterialQtyFromMenus: jest.fn().mockResolvedValue([{ COD_PROD_FINAL: 1, QTDUNIDUTILIZADA: '3' }])
            });
            const useCases = new EppStockUseCases({ repository, oracleRepository });

            const [row] = await useCases.getStock();

            expect(row.stock_quantity).toBe(16); // 10 + (3 * 2)
        });

        it('should fall back to unenriched row when Oracle fails', async () => {
            const repository = makeFakeRepository({
                findMenusForStock: jest.fn().mockResolvedValue([{ epp_id_product: 1, quantity: '2' }])
            });
            const oracleRepository = makeFakeOracleRepository({
                getRawMaterialQtyFromMenus: jest.fn().mockRejectedValue(new Error('Oracle down'))
            });
            const useCases = new EppStockUseCases({ repository, oracleRepository });

            const [row] = await useCases.getStock();

            expect(row.stock_quantity).toBe('10'); // unenriched, original string preserved
        });
    });

    describe('createStock', () => {
        it('should throw 400 when measure is "un" and quantity is not an integer', async () => {
            const useCases = new EppStockUseCases({ repository: makeFakeRepository(), oracleRepository: makeFakeOracleRepository() });

            await expect(useCases.createStock({ id_product_fk: 1, stock_quantity: 1.5, measure: 'un' }))
                .rejects.toThrow(AppError);
        });

        it('should throw 400 when outbound quantity exceeds current stock', async () => {
            const repository = makeFakeRepository({ findStockByProduct: jest.fn().mockResolvedValue([{ stock_quantity: '2' }]) });
            const useCases = new EppStockUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            await expect(useCases.createStock({ id_product_fk: 1, stock_quantity: -5, measure: 'kg' }))
                .rejects.toThrow(AppError);
        });
    });

    describe('updateStock', () => {
        it('should throw 404 when stock record does not exist', async () => {
            const repository = makeFakeRepository({ stockExists: jest.fn().mockResolvedValue(false) });
            const useCases = new EppStockUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            await expect(useCases.updateStock(99, {})).rejects.toThrow(AppError);
        });
    });
});
