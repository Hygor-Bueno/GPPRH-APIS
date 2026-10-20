const { isPayrollClosingWindow, assertOutsidePayrollClosing } = require('../payroll-closing-window.rules');

// Instantes em UTC; Brasília é UTC-3 o ano todo (sem horário de verão desde 2019).
describe('payroll-closing-window.rules', () => {
    it.each([
        ['segunda 12:00', '2026-10-19T15:00:00Z'],
        ['segunda 18:30', '2026-10-19T21:30:00Z'],
        ['segunda 23:59:59', '2026-10-20T02:59:59Z'],
    ])('bloqueia %s', (_label, iso) => {
        expect(isPayrollClosingWindow(new Date(iso))).toBe(true);
    });

    it.each([
        ['segunda 00:00', '2026-10-19T03:00:00Z'],
        ['segunda 11:59:59', '2026-10-19T14:59:59Z'],
        ['terça 00:00', '2026-10-20T03:00:00Z'],
        ['terça 12:00', '2026-10-20T15:00:00Z'],
        ['domingo 23:00', '2026-10-19T02:00:00Z'],
        ['sexta 14:00', '2026-10-23T17:00:00Z'],
    ])('libera %s', (_label, iso) => {
        expect(isPayrollClosingWindow(new Date(iso))).toBe(false);
    });

    it('usa a hora de Brasília, não a UTC: segunda 13:00 UTC ainda é manhã', () => {
        expect(isPayrollClosingWindow(new Date('2026-10-19T13:00:00Z'))).toBe(false);
    });

    it('o erro sai com 423 e code PAYROLL_CLOSING', () => {
        expect(() => assertOutsidePayrollClosing(new Date('2026-10-19T15:00:00Z')))
            .toThrow(expect.objectContaining({ statusCode: 423, code: 'PAYROLL_CLOSING' }));
        expect(() => assertOutsidePayrollClosing(new Date('2026-10-20T15:00:00Z'))).not.toThrow();
    });
});
