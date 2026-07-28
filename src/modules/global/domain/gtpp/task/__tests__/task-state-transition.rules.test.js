const {
    assertStructurallyAllowed, needsItemCountCheck, assertItemCountAllows,
} = require('../task-state-transition.rules');
const { AppError } = require('../../../../../../errors/app.error');

describe('assertStructurallyAllowed', () => {
    it('should allow -> DONE(6) only from VALIDATE(3)', () => {
        expect(() => assertStructurallyAllowed(6, 3)).not.toThrow();
        expect(() => assertStructurallyAllowed(6, 2)).toThrow(AppError);
    });

    it('should allow -> ARCHIVED(8) only from DONE(6)', () => {
        expect(() => assertStructurallyAllowed(8, 6)).not.toThrow();
        expect(() => assertStructurallyAllowed(8, 3)).toThrow(AppError);
    });

    it('should allow free transitions to other states', () => {
        expect(() => assertStructurallyAllowed(2, 1)).not.toThrow();
        expect(() => assertStructurallyAllowed(4, 2)).not.toThrow();
        expect(() => assertStructurallyAllowed(7, 1)).not.toThrow();
    });
});

describe('needsItemCountCheck', () => {
    it('should require count check only for TODO(1) and VALIDATE(3)', () => {
        expect(needsItemCountCheck(1)).toBe(true);
        expect(needsItemCountCheck(3)).toBe(true);
        expect(needsItemCountCheck(2)).toBe(false);
        expect(needsItemCountCheck(6)).toBe(false);
    });
});

describe('assertItemCountAllows', () => {
    it('should block -> TODO(1) when any item is checked', () => {
        expect(() => assertItemCountAllows(1, { total: 3, checked: 1 })).toThrow(AppError);
        expect(() => assertItemCountAllows(1, { total: 3, checked: 0 })).not.toThrow();
    });

    it('should block -> VALIDATE(3) unless all items are checked', () => {
        expect(() => assertItemCountAllows(3, { total: 3, checked: 2 })).toThrow(AppError);
        expect(() => assertItemCountAllows(3, { total: 3, checked: 3 })).not.toThrow();
    });

    it('should block -> VALIDATE(3) when there are zero items', () => {
        expect(() => assertItemCountAllows(3, { total: 0, checked: 0 })).toThrow(AppError);
    });
});
