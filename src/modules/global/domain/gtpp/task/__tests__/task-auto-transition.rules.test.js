const { computeAutoTransition } = require('../task-auto-transition.rules');

describe('computeAutoTransition', () => {
    it('TODO(1) -> DOING(2) when some item is checked', () => {
        const result = computeAutoTransition(1, { total: 3, checked: 1 });
        expect(result.newStateId).toBe(2);
    });

    it('DOING(2) -> TODO(1) when no item is checked', () => {
        const result = computeAutoTransition(2, { total: 3, checked: 0 });
        expect(result.newStateId).toBe(1);
    });

    it('DOING(2) -> VALIDATE(3) when all items are checked', () => {
        const result = computeAutoTransition(2, { total: 3, checked: 3 });
        expect(result.newStateId).toBe(3);
    });

    it('VALIDATE(3) -> DOING(2) when not all items are checked anymore', () => {
        const result = computeAutoTransition(3, { total: 3, checked: 2 });
        expect(result.newStateId).toBe(2);
    });

    it('should return null when no transition applies', () => {
        expect(computeAutoTransition(1, { total: 3, checked: 0 })).toBeNull();
        expect(computeAutoTransition(2, { total: 3, checked: 1 })).toBeNull();
        expect(computeAutoTransition(3, { total: 3, checked: 3 })).toBeNull();
    });

    it('should return null for states outside [1,2,3]', () => {
        expect(computeAutoTransition(6, { total: 3, checked: 3 })).toBeNull();
    });

    it('should treat zero items as "none checked", not "all checked"', () => {
        const result = computeAutoTransition(2, { total: 0, checked: 0 });
        expect(result.newStateId).toBe(1);
    });
});
