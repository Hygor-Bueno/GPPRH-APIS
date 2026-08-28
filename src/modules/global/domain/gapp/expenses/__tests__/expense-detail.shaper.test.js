const { shapeExpenseDetail } = require('../expense-detail.shaper');

describe('shapeExpenseDetail', () => {
    it('should attach fuel and null-out other sub-types when only fuel_id is present', () => {
        const row = {
            expen_id: 1, exp_type_id_fk: 1,
            fuel_id: 10, liter_value: 5, fuel_coupon_number: 'A1', fuel_km_day: 100,
            liter_qtd: 20, fuel_type_id_fk: 1, fuel_type_description: 'Gasolina',
            item_number: 1, fuel_detail: 'Abastecimento',
            maint_id: null, sinister_id: null, fine_id: null, id_insurance: null,
        };

        const result = shapeExpenseDetail(row);

        expect(result.fuel).toEqual({
            fuel_id: 10, liter_value: 5, coupon_number: 'A1', km_day: 100,
            liter_qtd: 20, fuel_type_id_fk: 1, fuel_type_description: 'Gasolina',
            item_number: 1, detail: 'Abastecimento',
        });
        expect(result.maintenance).toBeNull();
        expect(result.sinister).toBeNull();
        expect(result.fine).toBeNull();
        expect(result.insurance).toBeNull();
    });

    it('should return all sub-types null when none of the detail PKs are present', () => {
        const row = {
            expen_id: 2, exp_type_id_fk: 6,
            fuel_id: null, maint_id: null, sinister_id: null, fine_id: null, id_insurance: null,
        };

        const result = shapeExpenseDetail(row);

        expect(result.fuel).toBeNull();
        expect(result.maintenance).toBeNull();
        expect(result.sinister).toBeNull();
        expect(result.fine).toBeNull();
        expect(result.insurance).toBeNull();
    });

    it('should preserve generic expense fields', () => {
        const row = {
            expen_id: 5, date: '2026-01-01', hour: '10:00', description: 'Teste', total_value: 100,
            fuel_id: null, maint_id: null, sinister_id: null, fine_id: null, id_insurance: null,
        };

        const result = shapeExpenseDetail(row);

        expect(result.expen_id).toBe(5);
        expect(result.date).toBe('2026-01-01');
        expect(result.total_value).toBe(100);
    });
});
