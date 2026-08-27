const { validateOrderItems } = require('../order-items.validator');
const { AppError } = require('../../../../../../errors/app.error');

describe('validateOrderItems', () => {
    it('should throw when items is not an array', () => {
        expect(() => validateOrderItems(null)).toThrow(AppError);
    });

    it('should throw when items is empty', () => {
        expect(() => validateOrderItems([])).toThrow(AppError);
    });

    it('should throw when an item is missing epp_id_product', () => {
        expect(() => validateOrderItems([{ quantity: 1, price: 1 }])).toThrow(AppError);
    });

    it('should throw when an item is missing quantity', () => {
        expect(() => validateOrderItems([{ epp_id_product: 1, price: 1 }])).toThrow(AppError);
    });

    it('should throw when an item is missing price', () => {
        expect(() => validateOrderItems([{ epp_id_product: 1, quantity: 1 }])).toThrow(AppError);
    });

    it('should not throw for a valid items array', () => {
        expect(() => validateOrderItems([{ epp_id_product: 1, quantity: 1, price: 10 }])).not.toThrow();
    });
});
