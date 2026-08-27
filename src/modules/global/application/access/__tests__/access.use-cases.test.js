const { AccessUseCases } = require('../access.use-cases');
const { AccessRepositoryPort } = require('../ports/access-repository.port');
const { AppError } = require('../../../../../errors/app.error');

function makeFakeRepository(overrides = {}) {
    const repo = new AccessRepositoryPort();
    repo.findUsers = jest.fn().mockResolvedValue([{ id: 1, user: 'fulano' }]);
    repo.findUserById = jest.fn().mockResolvedValue({ id: 1, user: 'fulano' });
    repo.insertUser = jest.fn().mockResolvedValue({ insertId: 1 });
    repo.updateUser = jest.fn().mockResolvedValue();
    repo.patchUser = jest.fn().mockResolvedValue();
    repo.deactivateUser = jest.fn().mockResolvedValue();

    repo.findRoles = jest.fn().mockResolvedValue([{ id: 1, name: 'ADMIN' }]);
    repo.findRoleById = jest.fn().mockResolvedValue({ id: 1, name: 'ADMIN' });
    repo.insertRole = jest.fn().mockResolvedValue({ insertId: 1 });
    repo.updateRole = jest.fn().mockResolvedValue();
    repo.countUsersByRole = jest.fn().mockResolvedValue(0);
    repo.deleteRole = jest.fn().mockResolvedValue();

    repo.findPermissions = jest.fn().mockResolvedValue([{ id: 1, code: 'MANAGE_X' }]);
    repo.findPermissionById = jest.fn().mockResolvedValue({ id: 1, code: 'MANAGE_X' });
    repo.insertPermission = jest.fn().mockResolvedValue({ id: 1, code: 'MANAGE_X' });
    repo.updatePermission = jest.fn().mockResolvedValue({ id: 1, code: 'MANAGE_X' });
    repo.countRolesByPermission = jest.fn().mockResolvedValue(0);
    repo.deletePermission = jest.fn().mockResolvedValue();

    repo.findUserRoles = jest.fn().mockResolvedValue([{ id: 1, name: 'ADMIN' }]);
    repo.insertUserRoles = jest.fn().mockResolvedValue();
    repo.deleteUserRole = jest.fn().mockResolvedValue();

    repo.findRolePermissions = jest.fn().mockResolvedValue([{ id: 1, code: 'MANAGE_X' }]);
    repo.insertRolePermissions = jest.fn().mockResolvedValue();
    repo.deleteRolePermission = jest.fn().mockResolvedValue();
    repo.replaceRolePermissions = jest.fn().mockResolvedValue();

    repo.findApplications = jest.fn().mockResolvedValue([{ id: 1, description: 'GTPP' }]);
    repo.findUserApplications = jest.fn().mockResolvedValue([{ id: 1, description: 'GTPP' }]);
    repo.insertUserApplication = jest.fn().mockResolvedValue();
    repo.deleteUserApplication = jest.fn().mockResolvedValue();

    return Object.assign(repo, overrides);
}

function makeUseCases({ repository } = {}) {
    return new AccessUseCases({ repository: repository ?? makeFakeRepository() });
}

describe('AccessUseCases', () => {
    describe('getUserById', () => {
        it('should throw 404 when the user does not exist', async () => {
            const repository = makeFakeRepository({ findUserById: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.getUserById(999)).rejects.toThrow(AppError);
        });
    });

    describe('createUser', () => {
        it('should hash a provided password and pass it to insertUser', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.createUser({ user: 'novo', password: 'segredo' }, 68);
            const [data] = repository.insertUser.mock.calls[0];
            expect(data.password).not.toBe('segredo');
            expect(data.password.length).toBeGreaterThan(20);
        });

        it('should default the password to "1234" when omitted', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.createUser({ user: 'novo' }, 68);
            const [data] = repository.insertUser.mock.calls[0];
            expect(data.password).not.toBe('1234'); // já hasheada
        });

        it('should map ER_DUP_ENTRY to a 409 naming the original username', async () => {
            const dupError = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
            const repository = makeFakeRepository({ insertUser: jest.fn().mockRejectedValue(dupError) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.createUser({ user: 'fulano' }, 68)).rejects.toThrow(/fulano/);
        });
    });

    describe('patchUser', () => {
        it('should throw 400 when no recognized fields are provided', async () => {
            const useCases = makeUseCases();
            await expect(useCases.patchUser(1, { unknown_field: 'x' }, 68)).rejects.toThrow(AppError);
        });

        it('should hash the password field when present, and strip unknown fields', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.patchUser(1, { name: 'Novo Nome', password: 'novaSenha', unknown_field: 'x' }, 68);

            const [, fieldNames, fieldValues] = repository.patchUser.mock.calls[0];
            expect(fieldNames).toEqual(['name', 'password']);
            expect(fieldValues[0]).toBe('Novo Nome');
            expect(fieldValues[1]).not.toBe('novaSenha');
        });
    });

    describe('deactivateUser', () => {
        it('should throw 404 when the user does not exist, without deactivating', async () => {
            const repository = makeFakeRepository({ findUserById: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.deactivateUser(999, 68)).rejects.toThrow(AppError);
            expect(repository.deactivateUser).not.toHaveBeenCalled();
        });
    });

    describe('createRole', () => {
        it('should uppercase the name before inserting', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.createRole({ name: 'gestor_rh', description: 'x' });
            expect(repository.insertRole).toHaveBeenCalledWith({ name: 'GESTOR_RH', description: 'x' });
        });

        it('should map ER_DUP_ENTRY to a 409 naming the ORIGINAL (non-uppercased) name', async () => {
            const dupError = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
            const repository = makeFakeRepository({ insertRole: jest.fn().mockRejectedValue(dupError) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.createRole({ name: 'gestor_rh' })).rejects.toThrow(/gestor_rh/);
        });
    });

    describe('deleteRole', () => {
        it('should throw 409 when users still have this role', async () => {
            const repository = makeFakeRepository({ countUsersByRole: jest.fn().mockResolvedValue(3) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.deleteRole(1)).rejects.toThrow(AppError);
            expect(repository.deleteRole).not.toHaveBeenCalled();
        });

        it('should delete when no users have this role', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.deleteRole(1);
            expect(repository.deleteRole).toHaveBeenCalledWith(1);
        });
    });

    describe('deletePermission', () => {
        it('should throw 404 when the permission does not exist', async () => {
            const repository = makeFakeRepository({ findPermissionById: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.deletePermission(999)).rejects.toThrow(AppError);
        });

        it('should throw 409 when roles still use this permission', async () => {
            const repository = makeFakeRepository({ countRolesByPermission: jest.fn().mockResolvedValue(2) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.deletePermission(1)).rejects.toThrow(AppError);
            expect(repository.deletePermission).not.toHaveBeenCalled();
        });
    });

    describe('user <-> role links', () => {
        it('getUserRoles should throw 404 for a missing user', async () => {
            const repository = makeFakeRepository({ findUserById: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.getUserRoles(999)).rejects.toThrow(AppError);
        });

        it('assignRolesToUser should check existence then insert and return the updated list', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            const result = await useCases.assignRolesToUser(1, [2, 3]);
            expect(repository.insertUserRoles).toHaveBeenCalledWith(1, [2, 3]);
            expect(result).toEqual([{ id: 1, name: 'ADMIN' }]);
        });
    });

    describe('setRolePermissions', () => {
        it('should throw 404 for a missing role and never replace', async () => {
            const repository = makeFakeRepository({ findRoleById: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.setRolePermissions(999, [1, 2])).rejects.toThrow(AppError);
            expect(repository.replaceRolePermissions).not.toHaveBeenCalled();
        });

        it('should replace atomically when the role exists', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.setRolePermissions(1, [2, 3]);
            expect(repository.replaceRolePermissions).toHaveBeenCalledWith(1, [2, 3]);
        });
    });

    describe('application access', () => {
        it('grantApplicationAccess should throw 404 for a missing user', async () => {
            const repository = makeFakeRepository({ findUserById: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.grantApplicationAccess(999, 1)).rejects.toThrow(AppError);
        });

        it('revokeApplicationAccess should delegate to the repository', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            const result = await useCases.revokeApplicationAccess(1, 2);
            expect(repository.deleteUserApplication).toHaveBeenCalledWith(1, 2);
            expect(result).toEqual({ revoked: true });
        });
    });
});
