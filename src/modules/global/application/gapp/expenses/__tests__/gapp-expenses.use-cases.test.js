const { GappExpensesUseCases } = require('../gapp-expenses.use-cases');
const { ExpensesRepositoryPort } = require('../ports/expenses-repository.port');
const { GappUserRepositoryPort } = require('../../ports/gapp-user-repository.port');
const { AppError } = require('../../../../../../errors/app.error');

const GAPP_USER = { user_id: 10, work_group_fk: 5 };
const CURRENT_USER = { id: 1 };

function makeFakeRepository(overrides = {}) {
    const repo = new ExpensesRepositoryPort();
    repo.findActiveWorkGroup = jest.fn().mockResolvedValue({ work_group_fk: 5 });
    repo.findExpenseType = jest.fn().mockResolvedValue({ exp_type_id_fk: 1 });
    repo.createExpenseWithDetail = jest.fn().mockResolvedValue({ expen_id: 100 });
    repo.updateExpenseWithDetail = jest.fn().mockResolvedValue({ expen_id: 100 });
    repo.list = jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    repo.listVehicleExpenses = jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 });
    repo.findExpenseById = jest.fn().mockResolvedValue({ expen_id: 1, fuel_id: null, maint_id: null, sinister_id: null, fine_id: null, id_insurance: null });
    return Object.assign(repo, overrides);
}

function makeFakeUserRepository(overrides = {}) {
    const repo = new GappUserRepositoryPort();
    repo.findAuthByAccessCode = jest.fn().mockResolvedValue(GAPP_USER);
    return Object.assign(repo, overrides);
}

describe('GappExpensesUseCases', () => {
    describe('create', () => {
        it('should never use user_id_fk from the body (always resolved)', async () => {
            const repository = makeFakeRepository();
            const useCases = new GappExpensesUseCases({ repository, userRepository: makeFakeUserRepository() });

            await useCases.create({ exp_type_id_fk: 6, active_id_fk: 1, user_id_fk: 999 }, CURRENT_USER);

            expect(repository.createExpenseWithDetail).toHaveBeenCalledWith(
                expect.objectContaining({ user_id_fk: GAPP_USER.user_id }),
                6, null, 1
            );
        });

        it('should throw 404 when active_id_fk belongs to another work group', async () => {
            const repository = makeFakeRepository({ findActiveWorkGroup: jest.fn().mockResolvedValue({ work_group_fk: 999 }) });
            const useCases = new GappExpensesUseCases({ repository, userRepository: makeFakeUserRepository() });

            await expect(useCases.create({ exp_type_id_fk: 6, active_id_fk: 1 }, CURRENT_USER)).rejects.toThrow(AppError);
            expect(repository.createExpenseWithDetail).not.toHaveBeenCalled();
        });

        it('should resolve fuel liter_value before delegating to the repository', async () => {
            const repository = makeFakeRepository();
            const useCases = new GappExpensesUseCases({ repository, userRepository: makeFakeUserRepository() });

            await useCases.create({
                exp_type_id_fk: 1, active_id_fk: 1, total_value: 50,
                fuel: { liter_qtd: 10 }
            }, CURRENT_USER);

            expect(repository.createExpenseWithDetail).toHaveBeenCalledWith(
                expect.anything(), 1, expect.objectContaining({ liter_value: 5 }), 1
            );
        });
    });

    describe('update', () => {
        it('should throw 404 when the expense does not exist', async () => {
            const repository = makeFakeRepository({ findExpenseType: jest.fn().mockResolvedValue(null) });
            const useCases = new GappExpensesUseCases({ repository, userRepository: makeFakeUserRepository() });

            await expect(useCases.update(99, { exp_type_id_fk: 1 }, CURRENT_USER)).rejects.toThrow(AppError);
        });

        it('should reject 400 when trying to change exp_type_id_fk, without calling updateExpenseWithDetail', async () => {
            const repository = makeFakeRepository({ findExpenseType: jest.fn().mockResolvedValue({ exp_type_id_fk: 1 }) });
            const useCases = new GappExpensesUseCases({ repository, userRepository: makeFakeUserRepository() });

            await expect(useCases.update(1, { exp_type_id_fk: 2 }, CURRENT_USER)).rejects.toThrow(AppError);
            expect(repository.updateExpenseWithDetail).not.toHaveBeenCalled();
        });

        it('should delegate to updateExpenseWithDetail when type matches', async () => {
            const repository = makeFakeRepository();
            const useCases = new GappExpensesUseCases({ repository, userRepository: makeFakeUserRepository() });

            const result = await useCases.update(1, { exp_type_id_fk: 1, active_id_fk: 1 }, CURRENT_USER);

            expect(repository.updateExpenseWithDetail).toHaveBeenCalled();
            expect(result).toEqual({ expen_id: 100 });
        });
    });

    describe('list / listVehicleExpenses', () => {
        it('should scope list by the resolved work_group_fk', async () => {
            const repository = makeFakeRepository();
            const useCases = new GappExpensesUseCases({ repository, userRepository: makeFakeUserRepository() });

            await useCases.list({ work_group_fk: 999 }, CURRENT_USER);

            expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({ work_group_fk: GAPP_USER.work_group_fk }));
        });

        it('should scope listVehicleExpenses by the resolved work_group_fk', async () => {
            const repository = makeFakeRepository();
            const useCases = new GappExpensesUseCases({ repository, userRepository: makeFakeUserRepository() });

            await useCases.listVehicleExpenses({ work_group_fk: 999 }, CURRENT_USER);

            expect(repository.listVehicleExpenses).toHaveBeenCalledWith(expect.objectContaining({ work_group_fk: GAPP_USER.work_group_fk }));
        });
    });

    describe('getById', () => {
        it('should throw 404 when not found and shape the result otherwise', async () => {
            const repositoryNotFound = makeFakeRepository({ findExpenseById: jest.fn().mockResolvedValue(null) });
            const useCasesNotFound = new GappExpensesUseCases({ repository: repositoryNotFound, userRepository: makeFakeUserRepository() });
            await expect(useCasesNotFound.getById(999, CURRENT_USER)).rejects.toThrow(AppError);

            const repository = makeFakeRepository();
            const useCases = new GappExpensesUseCases({ repository, userRepository: makeFakeUserRepository() });
            const result = await useCases.getById(1, CURRENT_USER);
            expect(result.fuel).toBeNull();
            expect(result.expen_id).toBe(1);
        });
    });
});
