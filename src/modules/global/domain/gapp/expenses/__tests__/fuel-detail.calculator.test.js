const { resolveFuelDetail } = require('../fuel-detail.calculator');

describe('resolveFuelDetail', () => {
    it('should keep liter_value unchanged when already present', () => {
        const detail = { liter_value: 5.5, liter_qtd: 10 };
        expect(resolveFuelDetail(detail, 100)).toBe(detail);
    });

    it('should compute liter_value as total_value / liter_qtd when absent', () => {
        const detail = { liter_qtd: 10 };
        const result = resolveFuelDetail(detail, 55);
        expect(result.liter_value).toBe(5.5);
    });

    it('should return detail unchanged when liter_qtd is missing/zero', () => {
        const detail = { liter_qtd: 0 };
        expect(resolveFuelDetail(detail, 100)).toBe(detail);
    });

    it('should return detail unchanged when total_value is not finite', () => {
        const detail = { liter_qtd: 10 };
        expect(resolveFuelDetail(detail, NaN)).toBe(detail);
    });
});
