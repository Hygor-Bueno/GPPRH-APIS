const { GtppTaskUserUseCases } = require('../gtpp-task-user.use-cases');
const { TaskUserRepositoryPort } = require('../ports/task-user-repository.port');
const { GtppTaskGuardRepositoryPort } = require('../../ports/gtpp-task-guard-repository.port');
const { GtppEventPublisherPort } = require('../../ports/gtpp-event-publisher.port');
const { AppError } = require('../../../../../../errors/app.error');

const OWNER = { id: 10, permissions: [] };
const STRANGER = { id: 42, permissions: [] };

function makeFakeRepository(overrides = {}) {
    const repo = new TaskUserRepositoryPort();
    repo.findTaskUsers = jest.fn().mockResolvedValue([{ user_id: 2, name: 'Fulano', check: false }]);
    repo.isUserInTask = jest.fn().mockResolvedValue(false);
    repo.addUser = jest.fn().mockResolvedValue();
    repo.removeUser = jest.fn().mockResolvedValue();
    return Object.assign(repo, overrides);
}

function makeFakeTaskGuardRepository(overrides = {}) {
    const repo = new GtppTaskGuardRepositoryPort();
    repo.findStateAndCreator = jest.fn().mockResolvedValue({ stateId: 2, creatorId: OWNER.id });
    return Object.assign(repo, overrides);
}

function makeFakeEventPublisher(overrides = {}) {
    const publisher = new GtppEventPublisherPort();
    publisher.broadcastEvent = jest.fn().mockResolvedValue();
    return Object.assign(publisher, overrides);
}

function makeUseCases({ repository, taskGuardRepository, eventPublisher } = {}) {
    return new GtppTaskUserUseCases({
        repository: repository ?? makeFakeRepository(),
        taskGuardRepository: taskGuardRepository ?? makeFakeTaskGuardRepository(),
        eventPublisher: eventPublisher ?? makeFakeEventPublisher(),
    });
}

describe('GtppTaskUserUseCases', () => {
    describe('toggleTaskUser', () => {
        it('should throw 404 when the task does not exist', async () => {
            const taskGuardRepository = makeFakeTaskGuardRepository({ findStateAndCreator: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ taskGuardRepository });
            await expect(useCases.toggleTaskUser(999, 2, OWNER)).rejects.toThrow(AppError);
        });

        it('should reject when the current user is neither the owner nor an admin', async () => {
            const useCases = makeUseCases();
            await expect(useCases.toggleTaskUser(1, 2, STRANGER)).rejects.toThrow(AppError);
        });

        it('should reject when the task is in a blocked (non-editable) state', async () => {
            const taskGuardRepository = makeFakeTaskGuardRepository({
                findStateAndCreator: jest.fn().mockResolvedValue({ stateId: 6, creatorId: OWNER.id }),
            });
            const useCases = makeUseCases({ taskGuardRepository });
            await expect(useCases.toggleTaskUser(1, 2, OWNER)).rejects.toThrow(AppError);
        });

        it('should add the user when not yet linked', async () => {
            const repository = makeFakeRepository({ isUserInTask: jest.fn().mockResolvedValue(false) });
            const useCases = makeUseCases({ repository });
            const result = await useCases.toggleTaskUser(1, 2, OWNER);
            expect(repository.addUser).toHaveBeenCalledWith(1, 2);
            expect(result).toEqual({ action: 'added' });
        });

        it('should remove the user when already linked, and include them in the WS event', async () => {
            const repository = makeFakeRepository({ isUserInTask: jest.fn().mockResolvedValue(true) });
            const eventPublisher = makeFakeEventPublisher();
            const useCases = makeUseCases({ repository, eventPublisher });

            const result = await useCases.toggleTaskUser(1, 2, OWNER);

            expect(repository.removeUser).toHaveBeenCalledWith(1, 2);
            expect(result).toEqual({ action: 'removed' });
            expect(eventPublisher.broadcastEvent).toHaveBeenCalledWith(1, OWNER.id, 5, { action: 'removed', id: 2 }, [2]);
        });
    });
});
