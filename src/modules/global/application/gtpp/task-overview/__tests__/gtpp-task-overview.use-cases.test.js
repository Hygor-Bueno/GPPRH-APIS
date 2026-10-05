const { GtppTaskOverviewUseCases } = require('../gtpp-task-overview.use-cases');
const { TaskOverviewRepositoryPort } = require('../ports/task-overview-repository.port');
const { CostCenterMemberRepositoryPort } = require('../ports/cost-center-member-repository.port');
const { AppError } = require('../../../../../../errors/app.error');

function makeFakeRepository(overrides = {}) {
    const repo = new TaskOverviewRepositoryPort();
    repo.findTasks = jest.fn().mockResolvedValue({ data: [{ id: 1 }], hasMore: true });
    repo.findUserIdsByEmployee = jest.fn().mockResolvedValue([55]);
    repo.countByState = jest.fn().mockResolvedValue([
        { state_id: 1, state_description: 'Fazer', state_color: '#fff', total: 3 },
        { state_id: 2, state_description: 'Fazendo', state_color: '#000', total: 4 },
    ]);
    return Object.assign(repo, overrides);
}

function makeFakeCostCenterMemberRepository(overrides = {}) {
    const repo = new CostCenterMemberRepositoryPort();
    repo.findMembers = jest.fn().mockResolvedValue([{ registration: '000001', branchCode: '0201' }]);
    return Object.assign(repo, overrides);
}

function makeUseCases({ repository, costCenterMemberRepository } = {}) {
    return new GtppTaskOverviewUseCases({
        repository: repository ?? makeFakeRepository(),
        costCenterMemberRepository: costCenterMemberRepository ?? makeFakeCostCenterMemberRepository(),
    });
}

describe('GtppTaskOverviewUseCases', () => {
    describe('listTasks', () => {
        it('should pass normalized filters to the repository and echo pagination', async () => {
            const repository = makeFakeRepository();
            const costCenterMemberRepository = makeFakeCostCenterMemberRepository();
            const useCases = makeUseCases({ repository, costCenterMemberRepository });

            const result = await useCases.listTasks({ branch_code: '0201', page: '2', limit: '10' });

            expect(repository.findTasks).toHaveBeenCalledWith(expect.objectContaining({ companyCode: '02', branchCode: '0201', page: 2, limit: 10 }));
            expect(costCenterMemberRepository.findMembers).not.toHaveBeenCalled();
            expect(result).toEqual({ data: [{ id: 1 }], page: 2, limit: 10, hasMore: true });
        });

        it('should turn user_id into userIds', async () => {
            const repository = makeFakeRepository();
            await makeUseCases({ repository }).listTasks({ user_id: '9' });
            expect(repository.findUserIdsByEmployee).not.toHaveBeenCalled();
            expect(repository.findTasks).toHaveBeenCalledWith(expect.objectContaining({ userIds: [9] }));
        });

        it('should resolve the Protheus employee to system users (creator or member)', async () => {
            const repository = makeFakeRepository();
            await makeUseCases({ repository }).listTasks({ employee_registration: '000123', employee_branch: '0201' });

            expect(repository.findUserIdsByEmployee).toHaveBeenCalledWith({ registration: '000123', branchCode: '0201' });
            expect(repository.findTasks).toHaveBeenCalledWith(expect.objectContaining({ userIds: [55], userRole: 'any' }));
        });

        it('should return an empty page when the employee has no system user', async () => {
            const repository = makeFakeRepository({ findUserIdsByEmployee: jest.fn().mockResolvedValue([]) });
            const result = await makeUseCases({ repository }).listTasks({ employee_registration: '000123', employee_branch: '0201' });

            expect(result).toEqual({ data: [], page: 1, limit: 50, hasMore: false });
            expect(repository.findTasks).not.toHaveBeenCalled();
        });

        it('should reject invalid filters before touching any repository', async () => {
            const repository = makeFakeRepository();
            const costCenterMemberRepository = makeFakeCostCenterMemberRepository();
            const useCases = makeUseCases({ repository, costCenterMemberRepository });

            await expect(useCases.listTasks({ cost_center_code: '1001' })).rejects.toThrow(AppError);
            expect(costCenterMemberRepository.findMembers).not.toHaveBeenCalled();
            expect(repository.findTasks).not.toHaveBeenCalled();
        });

        it('should resolve the cost center members in Protheus and pass them as creator pairs', async () => {
            const repository = makeFakeRepository();
            const costCenterMemberRepository = makeFakeCostCenterMemberRepository();
            const useCases = makeUseCases({ repository, costCenterMemberRepository });

            await useCases.listTasks({ company_code: '02', cost_center_code: '1001' });

            expect(costCenterMemberRepository.findMembers).toHaveBeenCalledWith({ companyCode: '02', costCenterCode: '1001', branchCode: null });
            expect(repository.findTasks).toHaveBeenCalledWith(expect.objectContaining({
                creatorPairs: [{ registration: '000001', branchCode: '0201' }],
            }));
        });

        it('should return an empty page without hitting MySQL when the cost center has no one', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({
                repository,
                costCenterMemberRepository: makeFakeCostCenterMemberRepository({ findMembers: jest.fn().mockResolvedValue([]) }),
            });

            const result = await useCases.listTasks({ company_code: '02', cost_center_code: '9999', limit: '10' });

            expect(result).toEqual({ data: [], page: 1, limit: 10, hasMore: false });
            expect(repository.findTasks).not.toHaveBeenCalled();
        });
    });

    describe('summarizeTasks', () => {
        it('should add up the per-state totals', async () => {
            const result = await makeUseCases().summarizeTasks({});
            expect(result.total).toBe(7);
            expect(result.states).toHaveLength(2);
        });

        it('should return zero when the cost center has no one', async () => {
            const useCases = makeUseCases({
                costCenterMemberRepository: makeFakeCostCenterMemberRepository({ findMembers: jest.fn().mockResolvedValue([]) }),
            });
            expect(await useCases.summarizeTasks({ company_code: '02', cost_center_code: '9999' })).toEqual({ total: 0, states: [] });
        });
    });
});
