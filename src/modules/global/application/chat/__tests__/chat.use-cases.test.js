const { ChatUseCases } = require('../chat.use-cases');
const { ChatRepositoryPort } = require('../ports/chat-repository.port');
const { ChatEventPublisherPort } = require('../ports/chat-event-publisher.port');
const { AppError } = require('../../../../../errors/app.error');

function makeFakeRepository(overrides = {}) {
    const repo = new ChatRepositoryPort(20);
    repo.findConversations = jest.fn().mockResolvedValue([{ partner_id: 2 }]);
    repo.countMessages = jest.fn().mockResolvedValue(0);
    repo.findMessages = jest.fn().mockResolvedValue([]);
    repo.insertMessage = jest.fn().mockResolvedValue({ insertId: 99 });
    repo.findMessageById = jest.fn().mockResolvedValue({ id: 99, sender_id: 1, recipient_id: 2 });
    repo.markAsRead = jest.fn().mockResolvedValue({ updated: 0 });
    return Object.assign(repo, overrides);
}

function makeFakePublisher(overrides = {}) {
    const publisher = new ChatEventPublisherPort();
    publisher.publishMessageSent = jest.fn().mockResolvedValue(undefined);
    publisher.publishMessagesRead = jest.fn().mockResolvedValue(undefined);
    return Object.assign(publisher, overrides);
}

describe('ChatUseCases', () => {
    describe('getConversations', () => {
        it('should delegate to repository.findConversations', async () => {
            const repository = makeFakeRepository();
            const useCases = new ChatUseCases({ repository, eventPublisher: makeFakePublisher() });

            const result = await useCases.getConversations(1);

            expect(repository.findConversations).toHaveBeenCalledWith(1);
            expect(result).toEqual([{ partner_id: 2 }]);
        });
    });

    describe('getMessages', () => {
        it('should throw AppError for an invalid page', async () => {
            const useCases = new ChatUseCases({ repository: makeFakeRepository(), eventPublisher: makeFakePublisher() });

            await expect(useCases.getMessages(1, 2, 0)).rejects.toThrow(AppError);
        });

        it('should compute offset and pages from repository.pageSize', async () => {
            const repository = makeFakeRepository({
                countMessages: jest.fn().mockResolvedValue(45),
                findMessages: jest.fn().mockResolvedValue([{ id: 1 }])
            });
            const useCases = new ChatUseCases({ repository, eventPublisher: makeFakePublisher() });

            const result = await useCases.getMessages(1, 2, 2);

            expect(repository.findMessages).toHaveBeenCalledWith(1, 2, 20); // offset = (2-1) * pageSize(20)
            expect(result).toEqual({ messages: [{ id: 1 }], total: 45, page: 2, pages: 3 });
        });

        it('should return at least 1 page when total is 0', async () => {
            const repository = makeFakeRepository();
            const useCases = new ChatUseCases({ repository, eventPublisher: makeFakePublisher() });

            const result = await useCases.getMessages(1, 2, 1);

            expect(result.pages).toBe(1);
        });
    });

    describe('sendMessage', () => {
        it('should insert, re-fetch by id, and publish in order', async () => {
            const repository = makeFakeRepository();
            const eventPublisher = makeFakePublisher();
            const useCases = new ChatUseCases({ repository, eventPublisher });

            const calls = [];
            repository.insertMessage.mockImplementation(async () => { calls.push('insert'); return { insertId: 99 }; });
            repository.findMessageById.mockImplementation(async () => { calls.push('findById'); return { id: 99 }; });
            eventPublisher.publishMessageSent.mockImplementation(async () => { calls.push('publish'); });

            const result = await useCases.sendMessage({ senderId: 1, recipientId: 2, message: 'oi' });

            expect(calls).toEqual(['insert', 'findById', 'publish']);
            expect(repository.insertMessage).toHaveBeenCalledWith(expect.objectContaining({ senderId: 1, recipientId: 2, message: 'oi' }));
            expect(repository.findMessageById).toHaveBeenCalledWith(99);
            expect(eventPublisher.publishMessageSent).toHaveBeenCalledWith({ id: 99 });
            expect(result).toEqual({ id: 99 });
        });

        it('should reject self-send before touching the repository', async () => {
            const repository = makeFakeRepository();
            const useCases = new ChatUseCases({ repository, eventPublisher: makeFakePublisher() });

            await expect(useCases.sendMessage({ senderId: 1, recipientId: 1, message: 'oi' }))
                .rejects.toThrow(AppError);
            expect(repository.insertMessage).not.toHaveBeenCalled();
        });
    });

    describe('markAsRead', () => {
        it('should publish messagesRead when updated > 0', async () => {
            const repository = makeFakeRepository({ markAsRead: jest.fn().mockResolvedValue({ updated: 3 }) });
            const eventPublisher = makeFakePublisher();
            const useCases = new ChatUseCases({ repository, eventPublisher });

            const result = await useCases.markAsRead(1, 2);

            expect(eventPublisher.publishMessagesRead).toHaveBeenCalledWith({ readerId: 1, partnerId: 2 });
            expect(result).toEqual({ updated: 3 });
        });

        it('should not publish when nothing was updated', async () => {
            const repository = makeFakeRepository({ markAsRead: jest.fn().mockResolvedValue({ updated: 0 }) });
            const eventPublisher = makeFakePublisher();
            const useCases = new ChatUseCases({ repository, eventPublisher });

            await useCases.markAsRead(1, 2);

            expect(eventPublisher.publishMessagesRead).not.toHaveBeenCalled();
        });
    });
});
