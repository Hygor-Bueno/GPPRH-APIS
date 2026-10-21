const { assertAnyOwnerOrAdmin } = require('../task-ownership.guard');
const { AppError } = require('../../../../../../errors/app.error');

describe('assertAnyOwnerOrAdmin', () => {
    it('should pass when currentUserId is the single owner', () => {
        expect(() => assertAnyOwnerOrAdmin({ currentUserId: 1, ownerIds: [1], permissions: [] })).not.toThrow();
    });

    it('should pass when currentUserId is one of two owners (item + task)', () => {
        expect(() => assertAnyOwnerOrAdmin({ currentUserId: 5, ownerIds: [1, 5], permissions: [] })).not.toThrow();
    });

    it('should pass when not an owner but has an admin permission', () => {
        expect(() => assertAnyOwnerOrAdmin({ currentUserId: 99, ownerIds: [1], permissions: ['GTPP_MANAGE'] })).not.toThrow();
        expect(() => assertAnyOwnerOrAdmin({ currentUserId: 99, ownerIds: [1], permissions: ['SYSTEM_OWNER'] })).not.toThrow();
    });

    it('should throw 403 when neither owner nor admin', () => {
        expect(() => assertAnyOwnerOrAdmin({ currentUserId: 99, ownerIds: [1], permissions: ['GTPP_USE'] })).toThrow(AppError);
    });
});

describe('assertAnyOwnerOrAdmin — mensagem e code customizados', () => {
    it('should carry the given message and code on the 403', () => {
        try {
            assertAnyOwnerOrAdmin({ currentUserId: 99, ownerIds: [1], permissions: [], message: 'Sem acesso.', code: 'X_FORBIDDEN' });
            throw new Error('não lançou');
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect(err.statusCode).toBe(403);
            expect(err.message).toBe('Sem acesso.');
            expect(err.code).toBe('X_FORBIDDEN');
        }
    });
});
