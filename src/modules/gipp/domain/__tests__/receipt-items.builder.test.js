const { buildReceiptItems, parseWorkDate, PAYMENT_TYPE_CLOSING } = require('../receipt-items.builder');

const WS = { company_code: 1, branch_time_record: 203, employee_id: 4043, employee_name: 'Fulano', branch_name: 'Taboao' };

describe('receipt-items.builder', () => {
    describe('parseWorkDate', () => {
        it('should convert DD/MM/YYYY to a Date', () => {
            // new Date('YYYY-MM-DD') parses as UTC midnight — usar toISOString (UTC)
            // em vez de getters locais evita flakiness em fusos atrás de UTC (ex.: Brasil).
            const date = parseWorkDate('15/07/2026');
            expect(date.toISOString().slice(0, 10)).toBe('2026-07-15');
        });

        it('should return null when workDate is falsy', () => {
            expect(parseWorkDate(null)).toBeNull();
            expect(parseWorkDate('')).toBeNull();
        });
    });

    describe('buildReceiptItems', () => {
        it('should pad branch_code and employee_code and stamp payment_type_id', () => {
            const items = buildReceiptItems({
                ws: WS, pay: { normal_payment: 100, extra_hour_payment: 0, night_bonus_payment: 0 },
                dur: { FullExpedient: 1 }, workDate: '15/07/2026', codWorkSchedule: 'WS1', reference: '202607',
                receiptGroupId: 'uuid-1', userId: 68, userBranchCode: '0209',
            });
            expect(items).toHaveLength(1);
            expect(items[0].branch_code).toBe('0203');
            expect(items[0].employee_code).toBe('004043');
            expect(items[0].payment_type_id).toBe(PAYMENT_TYPE_CLOSING);
            expect(items[0].created_by).toBe('68');
        });

        it('should filter out items with amount <= 0', () => {
            const items = buildReceiptItems({
                ws: WS, pay: { normal_payment: 100, extra_hour_payment: 0, night_bonus_payment: 0 },
                dur: { FullExpedient: 1 }, workDate: '15/07/2026', codWorkSchedule: 'WS1', reference: '202607',
                receiptGroupId: 'uuid-1', userId: 68, userBranchCode: '0209',
            });
            expect(items).toHaveLength(1);
            expect(items[0].event_code).toBe('N|WS1');
        });

        it('should include all three items when all amounts are positive', () => {
            const items = buildReceiptItems({
                ws: WS, pay: { normal_payment: 100, extra_hour_payment: 50, night_bonus_payment: 20 },
                dur: { FullExpedient: 0, WorkMinutes: 340, WorkExtraMinutes: 90, NightMinutes: 30 },
                workDate: '15/07/2026', codWorkSchedule: 'WS1', reference: '202607',
                receiptGroupId: 'uuid-1', userId: 68, userBranchCode: '0209',
            });
            expect(items).toHaveLength(3);
            expect(items[0].description).toContain('5h40m');
            expect(items[1].description).toContain('1h30m');
            expect(items[2].description).toContain('30 min');
        });

        it('should use "1d" for the normal-hours description when FullExpedient is true', () => {
            const items = buildReceiptItems({
                ws: WS, pay: { normal_payment: 100, extra_hour_payment: 0, night_bonus_payment: 0 },
                dur: { FullExpedient: 1, WorkMinutes: 480 }, workDate: '15/07/2026', codWorkSchedule: 'WS1', reference: '202607',
                receiptGroupId: 'uuid-1', userId: 68, userBranchCode: '0209',
            });
            expect(items[0].description).toContain('1d');
        });

        it('should return an empty array when every amount is zero', () => {
            const items = buildReceiptItems({
                ws: WS, pay: { normal_payment: 0, extra_hour_payment: 0, night_bonus_payment: 0 },
                dur: {}, workDate: null, codWorkSchedule: 'WS1', reference: '202607',
                receiptGroupId: 'uuid-1', userId: 68, userBranchCode: '0209',
            });
            expect(items).toEqual([]);
        });
    });
});
