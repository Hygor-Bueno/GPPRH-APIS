const { GtppTaskScopeUseCases } = require('../gtpp-task-scope.use-cases');
const { TaskScopeRepositoryPort } = require('../ports/task-scope-repository.port');
const { GtppTaskGuardRepositoryPort } = require('../../ports/gtpp-task-guard-repository.port');
const { AppError } = require('../../../../../../errors/app.error');

function makeFakeRepository(overrides = {}) {
    const repo = new TaskScopeRepositoryPort();
    repo.findByTask = jest.fn().mockResolvedValue([{ id: 1, task_id: 5, company_code: '01', branch_code: null, cost_center_code: null }]);
    repo.insert = jest.fn().mockResolvedValue({ id: 2 });
    repo.remove = jest.fn().mockResolvedValue({ affectedRows: 1 });
    return Object.assign(repo, overrides);
}

function makeFakeTaskGuardRepository(overrides = {}) {
    const repo = new GtppTaskGuardRepositoryPort();
    repo.findStateAndCreator = jest.fn().mockResolvedValue({ stateId: 2, creatorId: 10 });
    return Object.assign(repo, overrides);
}

function makeUseCases({ repository, taskGuardRepository } = {}) {
    return new GtppTaskScopeUseCases({
        repository: repository ?? makeFakeRepository(),
        taskGuardRepository: taskGuardRepository ?? makeFakeTaskGuardRepository(),
    });
}

describe('GtppTaskScopeUseCases', () => {
    describe('getTaskScope', () => {
        it('should delegate to the repository', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            const result = await useCases.getTaskScope(5);
            expect(repository.findByTask).toHaveBeenCalledWith(5);
            expect(result).toHaveLength(1);
        });
    });

    describe('addTaskScope', () => {
        it('should throw 404 when the task does not exist', async () => {
            const taskGuardRepository = makeFakeTaskGuardRepository({ findStateAndCreator: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ taskGuardRepository });
            await expect(useCases.addTaskScope(999, {})).rejects.toThrow(AppError);
        });

        it('should throw when the task is in a blocked (non-editable) state', async () => {
            const taskGuardRepository = makeFakeTaskGuardRepository({ findStateAndCreator: jest.fn().mockResolvedValue({ stateId: 8, creatorId: 10 }) });
            const useCases = makeUseCases({ taskGuardRepository });
            await expect(useCases.addTaskScope(5, { company_code: '01' })).rejects.toThrow(AppError);
        });

        it('should insert with null defaults for omitted levels', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.addTaskScope(5, { company_code: '01' });
            expect(repository.insert).toHaveBeenCalledWith(5, { company_code: '01', branch_code: null, cost_center_code: null });
        });
    });

    describe('removeTaskScope', () => {
        it('should throw 404 when nothing was removed', async () => {
            const repository = makeFakeRepository({ remove: jest.fn().mockResolvedValue({ affectedRows: 0 }) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.removeTaskScope(5, 999)).rejects.toThrow(AppError);
        });
    });
});
