const { computeDeadlinePercent } = require('../item-deadline-percent.rules');

// mysql2 devolve DATE como Date à meia-noite local.
const day = (y, m, d) => new Date(y, m - 1, d);
const at = (y, m, d, h) => new Date(y, m - 1, d, h);

describe('computeDeadlinePercent', () => {
    it('should return null when the item has no deadline', () => {
        expect(computeDeadlinePercent(null, null, null)).toBeNull();
        expect(computeDeadlinePercent(null, day(2026, 10, 5), null)).toBeNull();
    });

    it('should pass the SQL value through untouched, including "0"', () => {
        const now = at(2026, 10, 5, 12);
        expect(computeDeadlinePercent('0', day(2026, 10, 5), day(2026, 10, 9), now)).toBe('0');
        expect(computeDeadlinePercent('36', day(2026, 10, 1), day(2026, 10, 12), now)).toBe('36');
        expect(computeDeadlinePercent(0, day(2026, 10, 5), day(2026, 10, 9), now)).toBe(0);
    });

    describe('same-day item (SQL returns null)', () => {
        const d = day(2026, 10, 10);

        it('should be 0 before the day', () => {
            expect(computeDeadlinePercent(null, d, d, at(2026, 10, 5, 23))).toBe(0);
        });

        it('should be 100 after the day', () => {
            expect(computeDeadlinePercent(null, d, d, at(2026, 10, 11, 0))).toBe(100);
        });

        it('should follow the hour of the day on the day itself', () => {
            expect(computeDeadlinePercent(null, d, d, at(2026, 10, 10, 0))).toBe(0);
            expect(computeDeadlinePercent(null, d, d, at(2026, 10, 10, 12))).toBe(50);
        });

        it('should accept YYYY-MM-DD strings', () => {
            expect(computeDeadlinePercent(null, '2026-10-10', '2026-10-10', at(2026, 10, 9, 12))).toBe(0);
        });
    });
});
