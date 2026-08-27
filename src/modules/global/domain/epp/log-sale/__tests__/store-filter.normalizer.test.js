const { normalizeStoreFilters } = require('../store-filter.normalizer');

describe('normalizeStoreFilters', () => {
    it('should normalize store and delivery_store to the plain store name', () => {
        const result = normalizeStoreFilters({ store: 'Interlagos_1', delivery_store: 'Centro_2' });
        expect(result.store).toBe('Interlagos');
        expect(result.delivery_store).toBe('Centro');
    });

    it('should leave other filters untouched', () => {
        const result = normalizeStoreFilters({ epp_id_product: 5 });
        expect(result).toEqual({ epp_id_product: 5 });
    });

    it('should not mutate the original filters object', () => {
        const original = { store: 'Interlagos_1' };
        normalizeStoreFilters(original);
        expect(original.store).toBe('Interlagos_1');
    });
});
