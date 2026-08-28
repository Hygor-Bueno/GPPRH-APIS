const { normalizeChatMessageType } = require('../chat-message-type.mapper');

describe('normalizeChatMessageType', () => {
    it('should default to TEXT (1) when raw is undefined', () => {
        expect(normalizeChatMessageType(undefined)).toBe(1);
    });

    it('should default to TEXT (1) when raw is null', () => {
        expect(normalizeChatMessageType(null)).toBe(1);
    });

    it.each([
        ['text', 1],
        ['image', 2],
        ['file', 3],
        ['TEXT', 1],
        ['Image', 2],
        [' file ', 3]
    ])('should map string "%s" to %i', (raw, expected) => {
        expect(normalizeChatMessageType(raw)).toBe(expected);
    });

    it.each([1, 2, 3])('should pass through valid integer %i', (raw) => {
        expect(normalizeChatMessageType(raw)).toBe(raw);
    });

    it('should default to TEXT (1) for an unknown string', () => {
        expect(normalizeChatMessageType('unknown')).toBe(1);
    });

    it('should default to TEXT (1) for an out-of-range integer', () => {
        expect(normalizeChatMessageType(99)).toBe(1);
    });
});
