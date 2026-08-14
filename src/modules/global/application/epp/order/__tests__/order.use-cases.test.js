const { EppOrderUseCases } = require('../order.use-cases');
const { OrderRepositoryPort } = require('../ports/order-repository.port');
const { OracleEppRepositoryPort } = require('../../ports/oracle-epp-repository.port');
const { AppError } = require('../../../../../../errors/app.error');

function isoDate(date) {
    return date.toISOString().slice(0, 10);
}

function makeFakeRepository(overrides = {}) {
    const repo = new OrderRepositoryPort();
    repo.findOrdersPending = jest.fn().mockResolvedValue([{ id_order: 1 }]);
    repo.findOrdersPendingByStore = jest.fn().mockResolvedValue([{ id_order: 2 }]);
    repo.findOrderById = jest.fn().mockResolvedValue({ id_order: 1, name_client: 'Cliente' });
    repo.getStoreByUser = jest.fn().mockResolvedValue({ number: 1, name: 'Interlagos' });
    repo.insertOrder = jest.fn().mockResolvedValue({ insertId: 1 });
    repo.updateOrder = jest.fn().mockResolvedValue({ updated: 1 });
    repo.changeOrderStatus = jest.fn().mockResolvedValue({ updated: 1 });
    repo.hasLinkedLogSales = jest.fn().mockResolvedValue(false);
    repo.deleteOrder = jest.fn().mockResolvedValue(undefined);
    repo.createOrderWithItems = jest.fn().mockResolvedValue({ order: { id_order: 1 }, items: [{ epp_id_log: 1 }] });
    repo.getProductsInfo = jest.fn().mockResolvedValue([{ id_product: 1, is_menu: 0 }]);
    return Object.assign(repo, overrides);
}

function makeFakeOracleRepository(overrides = {}) {
    const repo = new OracleEppRepositoryPort();
    repo.getEcommerceOrder = jest.fn().mockResolvedValue([{
        NROPEDIDOAFV: 123, DTAINCLUSAO: new Date('2026-01-01'), USUINCLUSAO: 'user1',
        COD_CLIENTE: 1, NOME_CLIENTE: 'JOAO SILVA', FONENRO1: '111', EMAIL: 'a@a.com',
        SEQPRODUTO: 1, DESCRICAO: 'Arroz', QUANTIDADE: 2, VALOR_UN_CONSINCO: 5, VALOR_CONSINCO: 10,
    }]);
    return Object.assign(repo, overrides);
}

describe('EppOrderUseCases', () => {
    describe('createOrder', () => {
        it('should resolve store, validate delivery date, insert, then refetch', async () => {
            const repository = makeFakeRepository();
            const useCases = new EppOrderUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            const result = await useCases.createOrder({ delivery_date: isoDate(new Date()), total: 10 }, 5);

            expect(repository.getStoreByUser).toHaveBeenCalledWith(5);
            expect(repository.insertOrder).toHaveBeenCalled();
            expect(repository.findOrderById).toHaveBeenCalledWith(1);
            expect(result).toEqual({ id_order: 1, name_client: 'Cliente' });
        });

        it('should throw 404 when user store is not found', async () => {
            const repository = makeFakeRepository({ getStoreByUser: jest.fn().mockResolvedValue(null) });
            const useCases = new EppOrderUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            await expect(useCases.createOrder({ delivery_date: isoDate(new Date()) }, 5)).rejects.toThrow(AppError);
        });

        it('should throw 422 before touching the repository when delivery date is invalid', async () => {
            const repository = makeFakeRepository();
            const useCases = new EppOrderUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            await expect(useCases.createOrder({ delivery_date: 'bad-date' }, 5)).rejects.toThrow(AppError);
        });
    });

    describe('deleteOrder', () => {
        it('should throw 409 when order has linked log sales', async () => {
            const repository = makeFakeRepository({ hasLinkedLogSales: jest.fn().mockResolvedValue(true) });
            const useCases = new EppOrderUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            await expect(useCases.deleteOrder(1)).rejects.toThrow(AppError);
            expect(repository.deleteOrder).not.toHaveBeenCalled();
        });

        it('should throw 404 when order does not exist', async () => {
            const repository = makeFakeRepository({ findOrderById: jest.fn().mockResolvedValue(null) });
            const useCases = new EppOrderUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            await expect(useCases.deleteOrder(99)).rejects.toThrow(AppError);
        });
    });

    describe('createOrderWithItems', () => {
        it('should delegate to the atomic repository port', async () => {
            const repository = makeFakeRepository();
            const useCases = new EppOrderUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            const result = await useCases.createOrderWithItems(
                { delivery_date: isoDate(new Date()), total: 10 },
                [{ epp_id_product: 1, quantity: 1, price: 5 }],
                5
            );

            expect(repository.createOrderWithItems).toHaveBeenCalled();
            expect(result).toEqual({ order: { id_order: 1 }, items: [{ epp_id_log: 1 }] });
        });

        it('should throw 400 before touching the repository when items are invalid', async () => {
            const repository = makeFakeRepository();
            const useCases = new EppOrderUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            await expect(useCases.createOrderWithItems({ delivery_date: isoDate(new Date()) }, [], 5))
                .rejects.toThrow(AppError);
            expect(repository.createOrderWithItems).not.toHaveBeenCalled();
        });
    });

    describe('confirmEcommerceOrder', () => {
        it('should split registered/unregistered items and delegate to createOrderWithItems', async () => {
            const repository = makeFakeRepository();
            const useCases = new EppOrderUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            const result = await useCases.confirmEcommerceOrder(123, {
                delivery_date: isoDate(new Date()), delivery_hour: '12:00', delivery_store: 'Centro_1'
            }, 5);

            expect(result.partial).toBe(false);
            expect(result.warnings).toEqual([]);
            expect(repository.createOrderWithItems).toHaveBeenCalled();
        });

        it('should throw 422 when no items are registered', async () => {
            const repository = makeFakeRepository({ getProductsInfo: jest.fn().mockResolvedValue([]) });
            const useCases = new EppOrderUseCases({ repository, oracleRepository: makeFakeOracleRepository() });

            await expect(useCases.confirmEcommerceOrder(123, {
                delivery_date: isoDate(new Date()), delivery_hour: '12:00', delivery_store: 'Centro_1'
            }, 5)).rejects.toThrow(AppError);
        });

        it('should throw 404 when the ecommerce order does not exist in Consinco', async () => {
            const repository = makeFakeRepository();
            const oracleRepository = makeFakeOracleRepository({ getEcommerceOrder: jest.fn().mockResolvedValue([]) });
            const useCases = new EppOrderUseCases({ repository, oracleRepository });

            await expect(useCases.getEcommerceOrder(999)).rejects.toThrow(AppError);
        });
    });

    describe('changeOrderStatus', () => {
        it('should throw 400 for an invalid status', async () => {
            const useCases = new EppOrderUseCases({ repository: makeFakeRepository(), oracleRepository: makeFakeOracleRepository() });
            await expect(useCases.changeOrderStatus(1, 3)).rejects.toThrow(AppError);
        });
    });
});
