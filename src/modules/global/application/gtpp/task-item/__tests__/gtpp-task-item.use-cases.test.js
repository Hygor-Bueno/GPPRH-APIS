const { GtppTaskItemUseCases } = require('../gtpp-task-item.use-cases');
const { TaskItemRepositoryPort } = require('../ports/task-item-repository.port');
const { GtppTaskGuardRepositoryPort } = require('../../ports/gtpp-task-guard-repository.port');
const { GtppEventPublisherPort } = require('../../ports/gtpp-event-publisher.port');
const { AppError } = require('../../../../../../errors/app.error');

const OWNER = { id: 10, permissions: [] };
const STRANGER = { id: 42, permissions: [] };

function makeFakeRepository(overrides = {}) {
    const repo = new TaskItemRepositoryPort();
    repo.findByTask = jest.fn().mockResolvedValue([]);
    repo.findItemById = jest.fn().mockResolvedValue({ id: 1, task_id: 5, order: 2, created_by: OWNER.id });
    repo.findMaxOrder = jest.fn().mockResolvedValue(3);
    repo.findTaskDates = jest.fn().mockResolvedValue({ initial_date: null, final_date: null });
    repo.insertItem = jest.fn().mockResolvedValue({ itemId: 99 });
    repo.attachFile = jest.fn().mockResolvedValue({ affectedRows: 1 });
    repo.clearFile = jest.fn().mockResolvedValue({ affectedRows: 1 });
    repo.findItemFileInfo = jest.fn().mockResolvedValue(null);
    repo.findItemFileId = jest.fn().mockResolvedValue(7);
    repo.findItemFileBlob = jest.fn().mockResolvedValue(null);
    repo.updateCheck = jest.fn().mockResolvedValue({ affectedRows: 1 });
    repo.updateYesNo = jest.fn().mockResolvedValue({ affectedRows: 1 });
    repo.updateDescription = jest.fn().mockResolvedValue({ affectedRows: 1 });
    repo.updateAssignedTo = jest.fn().mockResolvedValue({ affectedRows: 1 });
    repo.updateStatus = jest.fn().mockResolvedValue({ affectedRows: 1 });
    repo.updateNote = jest.fn().mockResolvedValue({ affectedRows: 1 });
    repo.updateDates = jest.fn().mockResolvedValue({ affectedRows: 1 });
    repo.softDelete = jest.fn().mockResolvedValue({ affectedRows: 1 });
    repo.findAdjacentItem = jest.fn().mockResolvedValue({ id: 2, order: 1 });
    repo.updateOrder = jest.fn().mockResolvedValue();
    return Object.assign(repo, overrides);
}

function makeFakeTaskGuardRepository(overrides = {}) {
    const repo = new GtppTaskGuardRepositoryPort();
    repo.findStateAndCreator = jest.fn().mockResolvedValue({ stateId: 2, creatorId: OWNER.id });
    repo.findItemStats = jest.fn().mockResolvedValue({ total: 2, checked: 1 });
    repo.applyStateTransition = jest.fn().mockResolvedValue();
    return Object.assign(repo, overrides);
}

function makeFakeEventPublisher(overrides = {}) {
    const publisher = new GtppEventPublisherPort();
    publisher.broadcastEvent = jest.fn().mockResolvedValue();
    return Object.assign(publisher, overrides);
}

function makeUseCases({ repository, taskGuardRepository, eventPublisher } = {}) {
    return new GtppTaskItemUseCases({
        repository: repository ?? makeFakeRepository(),
        taskGuardRepository: taskGuardRepository ?? makeFakeTaskGuardRepository(),
        eventPublisher: eventPublisher ?? makeFakeEventPublisher(),
    });
}

describe('GtppTaskItemUseCases', () => {
    describe('auto-toggle engine (end-to-end via updateItemCheck)', () => {
        it('should apply the transition and broadcast auto:true when checking the last pending item (2 -> 3)', async () => {
            const taskGuardRepository = makeFakeTaskGuardRepository({
                findStateAndCreator: jest.fn().mockResolvedValue({ stateId: 2, creatorId: OWNER.id }),
                findItemStats: jest.fn().mockResolvedValue({ total: 3, checked: 3 }),
            });
            const eventPublisher = makeFakeEventPublisher();
            const useCases = makeUseCases({ taskGuardRepository, eventPublisher });

            await useCases.updateItemCheck(5, 1, 1, OWNER.id);

            expect(taskGuardRepository.applyStateTransition).toHaveBeenCalledWith(5, 3, expect.any(String));
            expect(eventPublisher.broadcastEvent).toHaveBeenCalledWith(5, OWNER.id, 6, { action: 'updated', state_id: 3, auto: true });
        });

        it('should NOT apply any transition when the item count is still partial', async () => {
            const taskGuardRepository = makeFakeTaskGuardRepository({
                findStateAndCreator: jest.fn().mockResolvedValue({ stateId: 2, creatorId: OWNER.id }),
                findItemStats: jest.fn().mockResolvedValue({ total: 3, checked: 1 }),
            });
            const eventPublisher = makeFakeEventPublisher();
            const useCases = makeUseCases({ taskGuardRepository, eventPublisher });

            await useCases.updateItemCheck(5, 1, 1, OWNER.id);

            expect(taskGuardRepository.applyStateTransition).not.toHaveBeenCalled();
            // The 'check' item event itself still fires — only the auto-transition (type 6) must not.
            expect(eventPublisher.broadcastEvent).not.toHaveBeenCalledWith(5, OWNER.id, 6, expect.anything());
        });

        it('should not run the engine at all when the task state is outside [1,2,3] but still editable', async () => {
            // state 4 (STOPPED) is outside the auto-toggle range [1,2,3] yet not a blocked/non-editable state
            const taskGuardRepository = makeFakeTaskGuardRepository({
                findStateAndCreator: jest.fn().mockResolvedValue({ stateId: 4, creatorId: OWNER.id }),
            });
            const useCases = makeUseCases({ taskGuardRepository });

            await useCases.updateItemCheck(5, 1, 1, OWNER.id);

            expect(taskGuardRepository.findItemStats).not.toHaveBeenCalled();
        });

        it('should swallow engine failures without propagating to the caller', async () => {
            // findStateAndCreator must still succeed here (it also backs the editability
            // guard, which runs before the mutation); the engine itself fails at findItemStats.
            const taskGuardRepository = makeFakeTaskGuardRepository({
                findItemStats: jest.fn().mockRejectedValue(new Error('db down')),
            });
            const useCases = makeUseCases({ taskGuardRepository });

            await expect(useCases.updateItemCheck(5, 1, 1, OWNER.id)).resolves.toBeUndefined();
        });
    });

    describe('editability guard', () => {
        it('should reject creating an item when the task is in a blocked (non-editable) state', async () => {
            const taskGuardRepository = makeFakeTaskGuardRepository({
                findStateAndCreator: jest.fn().mockResolvedValue({ stateId: 8, creatorId: OWNER.id }),
            });
            const useCases = makeUseCases({ taskGuardRepository });
            await expect(useCases.createTaskItem(5, OWNER.id, { description: 'Item' })).rejects.toThrow(AppError);
        });

        it('should reject checking an item when the task does not exist', async () => {
            const taskGuardRepository = makeFakeTaskGuardRepository({ findStateAndCreator: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ taskGuardRepository });
            await expect(useCases.updateItemCheck(999, 1, 1, OWNER.id)).rejects.toThrow(AppError);
        });
    });

    describe('createTaskItem', () => {
        it('should throw 400 when the description is blank', async () => {
            const useCases = makeUseCases();
            await expect(useCases.createTaskItem(5, OWNER.id, { description: '  ' })).rejects.toThrow(AppError);
        });

        it('should default yes_no to -1 when not provided', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.createTaskItem(5, OWNER.id, { description: 'Item' });
            expect(repository.insertItem).toHaveBeenCalledWith(5, expect.objectContaining({ yesNo: -1, order: 4 }));
        });

        it('should validate item dates against the parent task dates', async () => {
            const repository = makeFakeRepository({
                findTaskDates: jest.fn().mockResolvedValue({ initial_date: '2026-01-10', final_date: '2026-01-20' }),
            });
            const useCases = makeUseCases({ repository });
            await expect(useCases.createTaskItem(5, OWNER.id, {
                description: 'Item', initialDate: '2026-01-01', finalDate: '2026-01-15',
            })).rejects.toThrow(AppError);
        });
    });

    describe('updateItemDescription', () => {
        it('should throw 404 when nothing was updated', async () => {
            const repository = makeFakeRepository({ updateDescription: jest.fn().mockResolvedValue({ affectedRows: 0 }) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.updateItemDescription(5, 1, 'nova descrição', OWNER.id)).rejects.toThrow(AppError);
        });

        it('should broadcast the item event on success', async () => {
            const eventPublisher = makeFakeEventPublisher();
            const useCases = makeUseCases({ eventPublisher });
            await useCases.updateItemDescription(5, 1, 'nova descrição', OWNER.id);
            expect(eventPublisher.broadcastEvent).toHaveBeenCalledWith(5, OWNER.id, 2, { action: 'description', id: 1, description: 'nova descrição' });
        });
    });

    describe('updateItemPosition', () => {
        it('should throw 400 when there is no adjacent item in that direction', async () => {
            const repository = makeFakeRepository({ findAdjacentItem: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.updateItemPosition(5, 1, 'up', OWNER.id)).rejects.toThrow(AppError);
        });

        it('should swap the order of both items', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.updateItemPosition(5, 1, 'up', OWNER.id);
            expect(repository.updateOrder).toHaveBeenNthCalledWith(1, 1, 1);
            expect(repository.updateOrder).toHaveBeenNthCalledWith(2, 2, 2);
        });
    });

    describe('updateItemDates', () => {
        it('should reject when the current user is neither the item owner, the task owner, nor an admin', async () => {
            const repository = makeFakeRepository({ findItemById: jest.fn().mockResolvedValue({ id: 1, created_by: 77 }) });
            const taskGuardRepository = makeFakeTaskGuardRepository({ findStateAndCreator: jest.fn().mockResolvedValue({ stateId: 2, creatorId: 88 }) });
            const useCases = makeUseCases({ repository, taskGuardRepository });
            await expect(useCases.updateItemDates(5, 1, '2026-01-01', '2026-01-10', STRANGER)).rejects.toThrow(AppError);
        });

        it('should allow the item creator even if not the task creator', async () => {
            const repository = makeFakeRepository({ findItemById: jest.fn().mockResolvedValue({ id: 1, created_by: STRANGER.id }) });
            const taskGuardRepository = makeFakeTaskGuardRepository({ findStateAndCreator: jest.fn().mockResolvedValue({ stateId: 2, creatorId: 88 }) });
            const useCases = makeUseCases({ repository, taskGuardRepository });
            await expect(useCases.updateItemDates(5, 1, null, null, STRANGER)).resolves.toBeUndefined();
        });
    });

    describe('deleteTaskItem', () => {
        it('should throw 404 when nothing was deleted', async () => {
            const repository = makeFakeRepository({ softDelete: jest.fn().mockResolvedValue({ affectedRows: 0 }) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.deleteTaskItem(5, 1, OWNER.id)).rejects.toThrow(AppError);
        });
    });
});
