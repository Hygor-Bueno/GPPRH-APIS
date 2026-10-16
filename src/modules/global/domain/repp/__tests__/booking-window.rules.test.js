/**
 * @fileoverview Regras puras de agenda da REPP (`booking-window.rules`).
 */

const {
    parseWeekdays,
    isoWeekday,
    addMonths,
    minBookingStamp,
    maxBookingDate,
    bookingLimits,
    setupWindow,
    pickConflict,
} = require('../booking-window.rules');

describe('booking-window.rules', () => {
    it('parseWeekdays tolera lixo, repetição e ordem', () => {
        expect(parseWeekdays('2,4')).toEqual([2, 4]);
        expect(parseWeekdays(' 4, 2 ,2,9,x,')).toEqual([2, 4]);
        expect(parseWeekdays('')).toEqual([]);
        expect(parseWeekdays(null)).toEqual([]);
    });

    it('isoWeekday: segunda = 1, domingo = 7', () => {
        expect(isoWeekday('2026-10-12')).toBe(1);
        expect(isoWeekday('2026-10-13')).toBe(2);
        expect(isoWeekday('2026-10-15')).toBe(4);
        expect(isoWeekday('2026-10-18')).toBe(7);
    });

    it('addMonths: mesmo dia, ou o último do mês mais curto', () => {
        expect(addMonths('2026-10-15', 2)).toBe('2026-12-15');
        expect(addMonths('2026-12-31', 2)).toBe('2027-02-28');
        expect(addMonths('2027-12-31', 2)).toBe('2028-02-29');
        expect(addMonths('2026-11-30', 2)).toBe('2027-01-30');
    });

    it('24h e 2 meses a partir do relógio local', () => {
        const now = new Date(2026, 9, 15, 14, 30, 59);
        expect(minBookingStamp(now)).toBe('2026-10-16 14:30');
        expect(maxBookingDate(now)).toBe('2026-12-15');
        expect(bookingLimits({ blocked_weekdays: [2, 4], setup_minutes: 60 }, false, now)).toEqual({
            blocked_weekdays: [2, 4], setup_minutes: 60,
            min_booking_at: '2026-10-16T14:30', max_booking_date: '2026-12-15', booking_rules_exempt: false,
        });
        expect(bookingLimits({ blocked_weekdays: [], setup_minutes: 0 }, true, now))
            .toMatchObject({ min_booking_at: null, max_booking_date: null, booking_rules_exempt: true });
    });

    it('setupWindow alarga e prende ao dia', () => {
        expect(setupWindow({ start_time: '14:00', end_time: '15:00' }, 60)).toEqual({ start_time: '13:00', end_time: '16:00' });
        expect(setupWindow({ start_time: '00:30', end_time: '23:30' }, 60)).toEqual({ start_time: '00:00', end_time: '23:59' });
        expect(setupWindow({ start_time: '14:00', end_time: '15:00' }, 0)).toEqual({ start_time: '14:00', end_time: '15:00' });
    });

    it('pickConflict prefere sobreposição', () => {
        const schedule = { start_time: '11:30', end_time: '12:30' };
        expect(pickConflict([], schedule)).toBeNull();
        expect(pickConflict([{ start_time: '10:00', end_time: '11:00' }], schedule)).toMatchObject({ kind: 'setup' });
        expect(pickConflict([{ start_time: '10:00', end_time: '11:00' }, { start_time: '12:00', end_time: '13:00' }], schedule))
            .toEqual({ kind: 'overlap', conflict: { start_time: '12:00', end_time: '13:00' } });
    });
});
