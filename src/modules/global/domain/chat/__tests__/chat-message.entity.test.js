const { ChatMessageEntity } = require('../chat-message.entity');
const { AppError } = require('../../../../../errors/app.error');

describe('ChatMessageEntity', () => {
    it('should build a valid text message with defaults', () => {
        const entity = new ChatMessageEntity({ senderId: 1, recipientId: 2, message: '  oi  ' });

        expect(entity.senderId).toBe(1);
        expect(entity.recipientId).toBe(2);
        expect(entity.message).toBe('oi');
        expect(entity.type).toBe(1);
        expect(entity.fileId).toBeNull();
        expect(entity.fileName).toBeNull();
    });

    it('should normalize the type field', () => {
        const entity = new ChatMessageEntity({ senderId: 1, recipientId: 2, message: 'oi', type: 'image' });
        expect(entity.type).toBe(2);
    });

    it('should trim the message and treat blank as null', () => {
        const entity = new ChatMessageEntity({ senderId: 1, recipientId: 2, message: '   ', fileId: 10 });
        expect(entity.message).toBeNull();
    });

    it('should throw AppError with CHAT_SELF_SEND_NOT_ALLOWED when sender equals recipient', () => {
        expect(() => new ChatMessageEntity({ senderId: 1, recipientId: 1, message: 'oi' }))
            .toThrow(AppError);

        try {
            new ChatMessageEntity({ senderId: 1, recipientId: 1, message: 'oi' });
        } catch (err) {
            expect(err.code).toBe('CHAT_SELF_SEND_NOT_ALLOWED');
            expect(err.statusCode).toBe(400);
        }
    });
});
