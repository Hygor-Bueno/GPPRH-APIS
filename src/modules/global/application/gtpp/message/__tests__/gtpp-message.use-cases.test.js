const { GtppMessageUseCases } = require('../gtpp-message.use-cases');
const { MessageRepositoryPort } = require('../ports/message-repository.port');
const { GtppEventPublisherPort } = require('../../ports/gtpp-event-publisher.port');
const { AppError } = require('../../../../../../errors/app.error');

function makeFakeRepository(overrides = {}) {
    const repo = new MessageRepositoryPort();
    repo.findByTask = jest.fn().mockResolvedValue([]);
    repo.send = jest.fn().mockResolvedValue({ id: 99, description: 'oi', user_id: 10 });
    repo.remove = jest.fn().mockResolvedValue({ affectedRows: 1 });
    return Object.assign(repo, overrides);
}

function makeFakeEventPublisher(overrides = {}) {
    const publisher = new GtppEventPublisherPort();
    publisher.broadcastEvent = jest.fn().mockResolvedValue();
    return Object.assign(publisher, overrides);
}

function makeUseCases({ repository, eventPublisher } = {}) {
    return new GtppMessageUseCases({
        repository: repository ?? makeFakeRepository(),
        eventPublisher: eventPublisher ?? makeFakeEventPublisher(),
    });
}

describe('GtppMessageUseCases', () => {
    describe('sendMessage', () => {
        it('should throw 400 when neither text nor file are provided', async () => {
            const useCases = makeUseCases();
            await expect(useCases.sendMessage(5, 10, { description: null, file: null })).rejects.toThrow(AppError);
        });

        it('should allow a file-only message with no text', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await expect(useCases.sendMessage(5, 10, { description: null, file: { originalname: 'a.png' } })).resolves.toBeDefined();
            expect(repository.send).toHaveBeenCalled();
        });

        it('should broadcast EV_MESSAGE (1) with the created message spread into the payload', async () => {
            const eventPublisher = makeFakeEventPublisher();
            const useCases = makeUseCases({ eventPublisher });
            await useCases.sendMessage(5, 10, { description: 'oi', file: null });
            expect(eventPublisher.broadcastEvent).toHaveBeenCalledWith(5, 10, 1, { action: 'created', id: 99, description: 'oi', user_id: 10 });
        });
    });

    describe('deleteMessage', () => {
        it('should throw 404 when nothing was deleted', async () => {
            const repository = makeFakeRepository({ remove: jest.fn().mockResolvedValue({ affectedRows: 0 }) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.deleteMessage(1, 5, 10)).rejects.toThrow(AppError);
        });

        it('should broadcast EV_MESSAGE_DELETED (10) on success', async () => {
            const eventPublisher = makeFakeEventPublisher();
            const useCases = makeUseCases({ eventPublisher });
            await useCases.deleteMessage(1, 5, 10);
            expect(eventPublisher.broadcastEvent).toHaveBeenCalledWith(5, 10, 10, { action: 'deleted', id: 1 });
        });
    });
});
