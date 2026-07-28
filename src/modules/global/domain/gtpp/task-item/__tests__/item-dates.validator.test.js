const { parseDate, validateItemDates } = require('../item-dates.validator');
const { AppError } = require('../../../../../../errors/app.error');

describe('item-dates.validator', () => {
    describe('parseDate', () => {
        it('should return the value unchanged when valid', () => {
            expect(parseDate('2026-01-15', 'initial_date')).toBe('2026-01-15');
        });

        it('should throw AppError for an invalid date', () => {
            expect(() => parseDate('not-a-date', 'initial_date')).toThrow(AppError);
        });
    });

    describe('validateItemDates', () => {
        it('should do nothing when both dates are absent', () => {
            expect(() => validateItemDates(null, null, {})).not.toThrow();
        });

        it('should throw when only one of the two dates is provided', () => {
            expect(() => validateItemDates('2026-01-15', null, {})).toThrow(AppError);
            expect(() => validateItemDates(null, '2026-01-20', {})).toThrow(AppError);
        });

        it('should throw when initial_date is not before final_date', () => {
            expect(() => validateItemDates('2026-01-20', '2026-01-20', {})).toThrow(AppError);
            expect(() => validateItemDates('2026-01-25', '2026-01-20', {})).toThrow(AppError);
        });

        it('should throw when the item starts before the parent task', () => {
            const taskDates = { initial_date: '2026-01-10', final_date: '2026-01-31' };
            expect(() => validateItemDates('2026-01-05', '2026-01-15', taskDates)).toThrow(AppError);
        });

        it('should throw when the item ends after the parent task', () => {
            const taskDates = { initial_date: '2026-01-10', final_date: '2026-01-31' };
            expect(() => validateItemDates('2026-01-15', '2026-02-05', taskDates)).toThrow(AppError);
        });

        it('should pass when the item dates are within the parent task range', () => {
            const taskDates = { initial_date: '2026-01-10', final_date: '2026-01-31' };
            expect(() => validateItemDates('2026-01-15', '2026-01-20', taskDates)).not.toThrow();
        });

        it('should pass when the parent task has no dates set', () => {
            expect(() => validateItemDates('2026-01-15', '2026-01-20', { initial_date: null, final_date: null })).not.toThrow();
        });
    });
});
