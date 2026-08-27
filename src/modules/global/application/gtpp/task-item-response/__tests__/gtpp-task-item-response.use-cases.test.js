const { GtppTaskItemResponseUseCases } = require('../gtpp-task-item-response.use-cases');
const { TaskItemResponseRepositoryPort } = require('../ports/task-item-response-repository.port');
const { GtppEventPublisherPort } = require('../../ports/gtpp-event-publisher.port');
const { AppError } = require('../../../../../../errors/app.error');

function makeFakeRepository(overrides = {}) {
    const repo = new TaskItemResponseRepositoryPort();
    repo.findByItem = jest.fn().mockResolvedValue([]);
    repo.findTaskIdByItemId = jest.fn().mockResolvedValue(5);
    repo.create = jest.fn().mockResolvedValue({ responseId: 99 });
    repo.update = jest.fn().mockResolvedValue({ affectedRows: 1 });
    repo.softDelete = jest.fn().mockResolvedValue({ affectedRows: 1 });
    return Object.assign(repo, overrides);
}

function makeFakeEventPublisher(overrides = {}) {
    const publisher = new GtppEventPublisherPort();
    publisher.broadcastEvent = jest.fn().mockResolvedValue();
    return Object.assign(publisher, overrides);
}

function makeUseCases({ repository, eventPublisher } = {}) {
    return new GtppTaskItemResponseUseCases({
        repository: repository ?? makeFakeRepository(),
        eventPublisher: eventPublisher ?? makeFakeEventPublisher(),
    });
}

describe('GtppTaskItemResponseUseCases', () => {
    describe('createItemResponse', () => {
        it('should throw 404 when the parent item does not exist (no direct DB access from the controller anymore)', async () => {
            const repository = makeFakeRepository({ findTaskIdByItemId: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.createItemResponse(999, 10, { comment: 'oi' })).rejects.toThrow(AppError);
        });

        it('should throw 400 when the comment is blank', async () => {
            const useCases = makeUseCases();
            await expect(useCases.createItemResponse(1, 10, { comment: '  ' })).rejects.toThrow(AppError);
        });

        it('should broadcast EV_RESPONSE_NEW (7) with the resolved task id', async () => {
            const eventPublisher = makeFakeEventPublisher();
            const useCases = makeUseCases({ eventPublisher });
            const result = await useCases.createItemResponse(1, 10, { comment: 'oi' });
            expect(result).toEqual({ responseId: 99 });
            expect(eventPublisher.broadcastEvent).toHaveBeenCalledWith(5, 10, 7, { action: 'created', id: 99, item_id: 1, comment: 'oi' });
        });
    });

    describe('updateItemResponse', () => {
        it('should throw 404 when nothing was updated', async () => {
            const repository = makeFakeRepository({ update: jest.fn().mockResolvedValue({ affectedRows: 0 }) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.updateItemResponse(1, 'novo', 5, 10)).rejects.toThrow(AppError);
        });

        it('should silently skip the broadcast when the parent item cannot be resolved', async () => {
            const repository = makeFakeRepository({ findTaskIdByItemId: jest.fn().mockResolvedValue(null) });
            const eventPublisher = makeFakeEventPublisher();
            const useCases = makeUseCases({ repository, eventPublisher });
            await expect(useCases.updateItemResponse(1, 'novo', 5, 10)).resolves.toBeUndefined();
            expect(eventPublisher.broadcastEvent).not.toHaveBeenCalled();
        });
    });

    describe('deleteItemResponse', () => {
        it('should throw 404 when nothing was deleted', async () => {
            const repository = makeFakeRepository({ softDelete: jest.fn().mockResolvedValue({ affectedRows: 0 }) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.deleteItemResponse(1, 5, 10)).rejects.toThrow(AppError);
        });

        it('should resolve the task id before deleting, so the event can still be sent', async () => {
            const repository = makeFakeRepository();
            const eventPublisher = makeFakeEventPublisher();
            const useCases = makeUseCases({ repository, eventPublisher });
            await useCases.deleteItemResponse(1, 5, 10);
            expect(eventPublisher.broadcastEvent).toHaveBeenCalledWith(5, 10, 9, { action: 'deleted', id: 1, item_id: 5 });
        });
    });
});
