const { pickTypeDetail } = require('../expense-detail.selector');

describe('pickTypeDetail', () => {
    it.each([
        [1, 'fuel'], [2, 'maintenance'], [3, 'sinister'], [4, 'fine'], [5, 'insurance'],
    ])('should pick data.%s for exp_type_id_fk=%i', (expTypeId, field) => {
        const detail = { some: 'value' };
        const data = { exp_type_id_fk: expTypeId, [field]: detail };
        expect(pickTypeDetail(data)).toBe(detail);
    });

    it('should return null for type 6 (Outros, sem tabela de detalhe)', () => {
        expect(pickTypeDetail({ exp_type_id_fk: 6 })).toBeNull();
    });

    it('should return null for an unknown type', () => {
        expect(pickTypeDetail({ exp_type_id_fk: 99 })).toBeNull();
    });

    it('should coerce a string exp_type_id_fk', () => {
        const fuel = { liter_qtd: 10 };
        expect(pickTypeDetail({ exp_type_id_fk: '1', fuel })).toBe(fuel);
    });
});
