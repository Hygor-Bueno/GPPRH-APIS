const { normalizeCnpj, groupMysqlByCnpj, buildAuditResults } = require('../shop-audit.shaper');

describe('shop-audit.shaper', () => {
    describe('normalizeCnpj', () => {
        it('should strip non-digit characters', () => {
            expect(normalizeCnpj('12.345.678/0001-90')).toBe('12345678000190');
        });

        it('should return an empty string for null/undefined', () => {
            expect(normalizeCnpj(null)).toBe('');
            expect(normalizeCnpj(undefined)).toBe('');
        });
    });

    describe('groupMysqlByCnpj', () => {
        it('should consolidate multiple system codes into a single shop entry', () => {
            const rows = [
                { shop_id: 1, number: '01', description: 'Loja 1', cnpj: '111', system_name: 'c5', code: 'C5-1' },
                { shop_id: 1, number: '01', description: 'Loja 1', cnpj: '111', system_name: 'protheus', code: 'P-1' },
            ];
            const map = groupMysqlByCnpj(rows);
            expect(map.get('111').codes).toEqual({ c5: 'C5-1', protheus: 'P-1' });
        });

        it('should normalize the CNPJ used as the map key', () => {
            const rows = [{ shop_id: 1, number: '01', description: 'Loja 1', cnpj: '11.111/0001', system_name: null, code: null }];
            const map = groupMysqlByCnpj(rows);
            expect(map.has('111110001')).toBe(true);
        });
    });

    describe('buildAuditResults', () => {
        it('should mark shops found in mysql and merge their codes with the external one', () => {
            const mysqlByCnpj = new Map([['111', { shop_id: 5, codes: { c5: 'C5-1' } }]]);
            const externalRows = [{ code: 'EXT-1', description: 'Loja X', cnpj: '111' }];
            const result = buildAuditResults(externalRows, mysqlByCnpj, 'protheus');
            expect(result).toEqual([{
                cnpj: '111', description: 'Loja X', in_mysql: true, shop_id: 5,
                systems: { c5: 'C5-1', protheus: 'EXT-1', consinco: null },
            }]);
        });

        it('should mark shops not found in mysql with null shop_id and codes', () => {
            const result = buildAuditResults([{ code: 'EXT-2', description: 'Loja Y', cnpj: '222' }], new Map(), 'consinco');
            expect(result[0]).toEqual({
                cnpj: '222', description: 'Loja Y', in_mysql: false, shop_id: null,
                systems: { c5: null, protheus: null, consinco: 'EXT-2' },
            });
        });

        it('should deduplicate by cnpj, keeping the first occurrence', () => {
            const externalRows = [
                { code: 'A', description: 'first', cnpj: '111' },
                { code: 'B', description: 'second', cnpj: '111' },
            ];
            const result = buildAuditResults(externalRows, new Map(), 'protheus');
            expect(result).toHaveLength(1);
            expect(result[0].description).toBe('first');
        });

        it('should skip rows with no cnpj', () => {
            const result = buildAuditResults([{ code: 'A', description: 'no cnpj', cnpj: '' }], new Map(), 'protheus');
            expect(result).toHaveLength(0);
        });

        it('should sort mysql-registered shops before pending ones', () => {
            const mysqlByCnpj = new Map([['111', { shop_id: 1, codes: {} }]]);
            const externalRows = [
                { code: 'A', description: 'pending', cnpj: '222' },
                { code: 'B', description: 'registered', cnpj: '111' },
            ];
            const result = buildAuditResults(externalRows, mysqlByCnpj, 'protheus');
            expect(result.map(r => r.description)).toEqual(['registered', 'pending']);
        });
    });
});
