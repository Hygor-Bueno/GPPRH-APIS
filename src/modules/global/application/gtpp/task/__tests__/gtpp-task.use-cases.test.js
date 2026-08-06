const { GtppTaskUseCases } = require('../gtpp-task.use-cases');
const { TaskRepositoryPort } = require('../ports/task-repository.port');
const { GtppTaskGuardRepositoryPort } = require('../../ports/gtpp-task-guard-repository.port');
const { GtppEventPublisherPort } = require('../../ports/gtpp-event-publisher.port');
const { AppError } = require('../../../../../../errors/app.error');

const OWNER = { id: 10, permissions: [] };
const ADMIN = { id: 99, permissions: ['MANAGE_GTPP'] };
const STRANGER = { id: 42, permissions: [] };

function makeFakeRepository(overrides = {}) {
    const repo = new TaskRepositoryPort();
    repo.findTaskStates = jest.fn().mockResolvedValue([{ id: 1, description: 'Fazer', color: '#fff' }]);
    repo.findHistoric = jest.fn().mockResolvedValue([]);
    repo.findTasksForUser = jest.fn().mockResolvedValue({ data: [], hasMore: false });
    repo.findTasksForUserByStates = jest.fn().mockResolvedValue([]);
    repo.findTaskDetail = jest.fn().mockResolvedValue({ full_description: 'x', state_id: 1, task_item: [], task_user: [], csds: [] });
    repo.createTask = jest.fn().mockResolvedValue({ taskId: 123 });
    repo.updateStateDirect = jest.fn().mockResolvedValue();
    repo.extendFinalDate = jest.fn().mockResolvedValue();
    repo.insertHistoric = jest.fn().mockResolvedValue();
    repo.updateTitle = jest.fn().mockResolvedValue({ affectedRows: 1 });
    repo.updateDescription = jest.fn().mockResolvedValue({ affectedRows: 1 });
    repo.updateTheme = jest.fn().mockResolvedValue({ affectedRows: 1 });
    repo.deleteTask = jest.fn().mockResolvedValue({ affectedRows: 1 });
    return Object.assign(repo, overrides);
}

function makeFakeTaskGuardRepository(overrides = {}) {
    const repo = new GtppTaskGuardRepositoryPort();
    repo.findStateAndCreator = jest.fn().mockResolvedValue({ stateId: 3, creatorId: OWNER.id });
    repo.findItemStats = jest.fn().mockResolvedValue({ total: 2, checked: 2 });
    repo.applyStateTransition = jest.fn().mockResolvedValue();
    return Object.assign(repo, overrides);
}

function makeFakeEventPublisher(overrides = {}) {
    const publisher = new GtppEventPublisherPort();
    publisher.broadcastEvent = jest.fn().mockResolvedValue();
    return Object.assign(publisher, overrides);
}

function makeUseCases({ repository, taskGuardRepository, eventPublisher } = {}) {
    return new GtppTaskUseCases({
        repository: repository ?? makeFakeRepository(),
        taskGuardRepository: taskGuardRepository ?? makeFakeTaskGuardRepository(),
        eventPublisher: eventPublisher ?? makeFakeEventPublisher(),
    });
}

describe('GtppTaskUseCases', () => {
    describe('getTaskById', () => {
        it('should throw 404 when the task does not exist', async () => {
            const repository = makeFakeRepository({ findTaskDetail: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.getTaskById(999)).rejects.toThrow(AppError);
        });
    });

    describe('createTask', () => {
        it('should throw 400 when the title is blank', async () => {
            const useCases = makeUseCases();
            await expect(useCases.createTask(OWNER.id, { description: '   ' })).rejects.toThrow(AppError);
        });

        it('should trim the title before persisting', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.createTask(OWNER.id, { description: '  Título  ', fullDescription: null });
            expect(repository.createTask).toHaveBeenCalledWith(OWNER.id, expect.objectContaining({ description: 'Título' }));
        });
    });

    describe('updateTaskState', () => {
        it('should reject when the current user is neither the owner nor an admin', async () => {
            const taskGuardRepository = makeFakeTaskGuardRepository({
                findStateAndCreator: jest.fn().mockResolvedValue({ stateId: 3, creatorId: OWNER.id }),
            });
            const useCases = makeUseCases({ taskGuardRepository });
            await expect(useCases.updateTaskState(1, 6, 'desc', STRANGER, null)).rejects.toThrow(AppError);
        });

        it('should allow an admin who is not the owner', async () => {
            const taskGuardRepository = makeFakeTaskGuardRepository({
                findStateAndCreator: jest.fn().mockResolvedValue({ stateId: 3, creatorId: OWNER.id }),
            });
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository, taskGuardRepository });
            await useCases.updateTaskState(1, 6, 'desc', ADMIN, null);
            expect(repository.updateStateDirect).toHaveBeenCalledWith(1, 6);
        });

        it('should reject moving to DONE (6) from a state other than VALIDATE (3)', async () => {
            const taskGuardRepository = makeFakeTaskGuardRepository({
                findStateAndCreator: jest.fn().mockResolvedValue({ stateId: 2, creatorId: OWNER.id }),
            });
            const useCases = makeUseCases({ taskGuardRepository });
            await expect(useCases.updateTaskState(1, 6, null, OWNER, null)).rejects.toThrow(AppError);
        });

        it('should reject moving to VALIDATE (3) when not all items are checked', async () => {
            const taskGuardRepository = makeFakeTaskGuardRepository({
                findStateAndCreator: jest.fn().mockResolvedValue({ stateId: 2, creatorId: OWNER.id }),
                findItemStats: jest.fn().mockResolvedValue({ total: 3, checked: 1 }),
            });
            const useCases = makeUseCases({ taskGuardRepository });
            await expect(useCases.updateTaskState(1, 3, null, OWNER, null)).rejects.toThrow(AppError);
        });

        it('should extend the final date only when days is provided and positive', async () => {
            const repository = makeFakeRepository();
            const taskGuardRepository = makeFakeTaskGuardRepository({
                findStateAndCreator: jest.fn().mockResolvedValue({ stateId: 4, creatorId: OWNER.id }),
            });
            const useCases = makeUseCases({ repository, taskGuardRepository });

            await useCases.updateTaskState(1, 4, null, OWNER, 5);
            expect(repository.extendFinalDate).toHaveBeenCalledWith(1, 5);

            repository.extendFinalDate.mockClear();
            await useCases.updateTaskState(1, 4, null, OWNER, 0);
            expect(repository.extendFinalDate).not.toHaveBeenCalled();
        });

        it('should fire-and-forget the WS event without blocking on failure', async () => {
            const taskGuardRepository = makeFakeTaskGuardRepository({
                findStateAndCreator: jest.fn().mockResolvedValue({ stateId: 4, creatorId: OWNER.id }),
            });
            const eventPublisher = makeFakeEventPublisher({ broadcastEvent: jest.fn().mockRejectedValue(new Error('offline')) });
            const useCases = makeUseCases({ taskGuardRepository, eventPublisher });

            await expect(useCases.updateTaskState(1, 4, null, OWNER, null)).resolves.toBeUndefined();
        });
    });

    describe('updateTaskTitle', () => {
        it('should throw 400 when the title is blank', async () => {
            const useCases = makeUseCases();
            await expect(useCases.updateTaskTitle(1, '  ', OWNER)).rejects.toThrow(AppError);
        });

        it('should throw when the task is in a blocked (non-editable) state', async () => {
            const taskGuardRepository = makeFakeTaskGuardRepository({
                findStateAndCreator: jest.fn().mockResolvedValue({ stateId: 6, creatorId: OWNER.id }),
            });
            const useCases = makeUseCases({ taskGuardRepository });
            await expect(useCases.updateTaskTitle(1, 'Novo título', OWNER)).rejects.toThrow(AppError);
        });

        it('should broadcast the raw (untrimmed) title', async () => {
            const eventPublisher = makeFakeEventPublisher();
            const useCases = makeUseCases({ eventPublisher });
            await useCases.updateTaskTitle(1, '  Novo título  ', OWNER);
            expect(eventPublisher.broadcastEvent).toHaveBeenCalledWith(1, OWNER.id, 8, expect.objectContaining({ description: '  Novo título  ' }));
        });
    });

    describe('deleteTask', () => {
        it('should await the broadcast before deleting, and propagate broadcast failures', async () => {
            const repository = makeFakeRepository();
            const eventPublisher = makeFakeEventPublisher({ broadcastEvent: jest.fn().mockRejectedValue(new Error('boom')) });
            const useCases = makeUseCases({ repository, eventPublisher });

            await expect(useCases.deleteTask(1, OWNER)).rejects.toThrow('boom');
            expect(repository.deleteTask).not.toHaveBeenCalled();
        });

        it('should throw 404 when nothing was deleted', async () => {
            const repository = makeFakeRepository({ deleteTask: jest.fn().mockResolvedValue({ affectedRows: 0 }) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.deleteTask(1, OWNER)).rejects.toThrow(AppError);
        });
    });

    describe('getTasksBoard', () => {
        it('should fetch all states in a single repository call', async () => {
            const repository = makeFakeRepository({
                findTasksForUserByStates: jest.fn().mockResolvedValue([
                    { id: 1, state_id: 1 },
                    { id: 2, state_id: 2 },
                ]),
            });
            const useCases = makeUseCases({ repository });
            const board = await useCases.getTasksBoard(OWNER.id, { stateIds: [1, 2] });

            expect(repository.findTasksForUserByStates).toHaveBeenCalledTimes(1);
            expect(Object.keys(board)).toEqual(['1', '2']);
            expect(board[1].data).toEqual([{ id: 1, state_id: 1 }]);
            expect(board[2].data).toEqual([{ id: 2, state_id: 2 }]);
        });

        it('should key every requested state, even ones with no rows returned', async () => {
            const repository = makeFakeRepository({
                findTasksForUserByStates: jest.fn().mockResolvedValue([{ id: 1, state_id: 1 }]),
            });
            const useCases = makeUseCases({ repository });
            const board = await useCases.getTasksBoard(OWNER.id, { stateIds: [1, 2, 3] });

            expect(Object.keys(board)).toEqual(['1', '2', '3']);
            expect(board[2].data).toEqual([]);
            expect(board[3].data).toEqual([]);
        });

        it('should mark hasMore when a state\'s row count equals the limit', async () => {
            const repository = makeFakeRepository({
                findTasksForUserByStates: jest.fn().mockResolvedValue([
                    { id: 1, state_id: 1 }, { id: 2, state_id: 1 },
                ]),
            });
            const useCases = makeUseCases({ repository });
            const board = await useCases.getTasksBoard(OWNER.id, { stateIds: [1], limit: 2 });

            expect(board[1].hasMore).toBe(true);
        });
    });
});
