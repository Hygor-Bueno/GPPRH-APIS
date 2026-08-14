const { formatMinutes } = require('../duration.formatter');

describe('duration.formatter', () => {
    it('should return null for falsy or non-positive values', () => {
        expect(formatMinutes(null)).toBeNull();
        expect(formatMinutes(undefined)).toBeNull();
        expect(formatMinutes(0)).toBeNull();
        expect(formatMinutes(-5)).toBeNull();
    });

    it('should format sub-hour durations as minutes', () => {
        expect(formatMinutes(45)).toBe('45 min');
        expect(formatMinutes(1)).toBe('1 min');
    });

    it('should format exact-hour durations without minutes', () => {
        expect(formatMinutes(60)).toBe('1 h');
        expect(formatMinutes(480)).toBe('8 h');
    });

    it('should format mixed hour+minute durations', () => {
        expect(formatMinutes(340)).toBe('5h40m');
        expect(formatMinutes(61)).toBe('1h1m');
    });
});
