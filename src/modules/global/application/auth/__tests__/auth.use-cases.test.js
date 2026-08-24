// `bcrypt`'s native binding doesn't load on this Windows dev box over a UNC
// path — mocked with the pure-JS, hash-format-compatible `bcryptjs` for THIS
// TEST ONLY (used transitively via `User.setPassword`). Production code still
// requires the real `bcrypt`, untouched.
jest.mock('bcrypt', () => require('bcryptjs'));

const bcrypt = require('bcrypt');
const { AuthUseCases } = require('../auth.use-cases');
const { AuthRepositoryPort } = require('../ports/auth-repository.port');
const { ProtheusEmployeeRepositoryPort } = require('../ports/protheus-employee-repository.port');
const { LdapAuthenticatorPort } = require('../ports/ldap-authenticator.port');
const { AppError } = require('../../../../../errors/app.error');
const { UnauthorizedError } = require('../../../../../errors/unauthorized.error');

// Espelha o retorno de `sp_get_user_authorization`. Se a procedure ganhar uma
// coluna, este fixture precisa acompanhar — o mapper recusa payload incompleto.
const SESSION_ROW = {
    id: 1, user: 'fulano', name: 'Fulano Silva', registration: '123', ad_status: 'active',
    roles: 'ADMIN', permissions: 'A,B', application_ids: '1,2', branch_code: '0101',
    must_change_password: 0,
};

function makeFakeRepository(overrides = {}) {
    const repo = new AuthRepositoryPort();
    repo.findUserAuthorization = jest.fn().mockResolvedValue(SESSION_ROW);
    repo.findLocalUserByUsername = jest.fn().mockResolvedValue(null);
    repo.findUserByAdGuid = jest.fn().mockResolvedValue(null);
    repo.upsertAdLogin = jest.fn().mockResolvedValue({ result: 'LOGIN_OK' });
    return Object.assign(repo, overrides);
}

function makeFakeProtheusRepository(overrides = {}) {
    const repo = new ProtheusEmployeeRepositoryPort();
    repo.findEmployeeDataByName = jest.fn().mockResolvedValue([{ RA_NOME: 'Fulano', RA_MAT: '123', M0_CODFIL: '0101', TABELA: 'SRA020' }]);
    repo.findUserOrganization = jest.fn().mockResolvedValue({});
    return Object.assign(repo, overrides);
}

function makeFakeLdap(overrides = {}) {
    const ldap = new LdapAuthenticatorPort();
    ldap.authenticate = jest.fn().mockResolvedValue({ guid: 'guid-123', name: 'Fulano' });
    return Object.assign(ldap, overrides);
}

function makeUseCases({ repository, protheusRepository, ldapAuthenticator } = {}) {
    return new AuthUseCases({
        repository: repository ?? makeFakeRepository(),
        protheusRepository: protheusRepository ?? makeFakeProtheusRepository(),
        ldapAuthenticator: ldapAuthenticator ?? makeFakeLdap(),
    });
}

describe('AuthUseCases', () => {
    describe('login via AD — existing user', () => {
        it('should update the cached password and NOT query protheus employee data', async () => {
            const repository = makeFakeRepository({
                findUserByAdGuid: jest.fn().mockResolvedValue({ name: 'Fulano', registration: '123', branch_code: '0101', table_protheus: 'SRA020' }),
            });
            const protheusRepository = makeFakeProtheusRepository();
            const useCases = makeUseCases({ repository, protheusRepository });

            const result = await useCases.login('fulano', 'senha123');

            expect(repository.upsertAdLogin).toHaveBeenCalledTimes(1);
            expect(protheusRepository.findEmployeeDataByName).not.toHaveBeenCalled();
            expect(repository.findUserAuthorization).toHaveBeenCalledWith('guid-123');
            expect(result.username).toBe('fulano');
        });
    });

    describe('login via AD — first login (no existing mapping)', () => {
        it('should look up protheus employee data and create the local user', async () => {
            const repository = makeFakeRepository({ findUserByAdGuid: jest.fn().mockResolvedValue(null) });
            const protheusRepository = makeFakeProtheusRepository();
            const useCases = makeUseCases({ repository, protheusRepository });

            await useCases.login('fulano', 'senha123');

            expect(protheusRepository.findEmployeeDataByName).toHaveBeenCalledWith('Fulano');
            expect(repository.upsertAdLogin).toHaveBeenCalledTimes(1);
        });
    });

    describe('AD failure -> local fallback', () => {
        it('should fall back to local login when AD rejects with invalid credentials', async () => {
            const ldapAuthenticator = makeFakeLdap({ authenticate: jest.fn().mockRejectedValue(new Error('Invalid Credentials')) });
            const localHash = (await bcrypt.hash('senhaLocal', 10)).replace('$2b$', '$2y$');
            const repository = makeFakeRepository({
                findLocalUserByUsername: jest.fn().mockResolvedValue({ id: 42, password: localHash }),
            });
            const useCases = makeUseCases({ repository, ldapAuthenticator });

            await useCases.login('fulano', 'senhaLocal');

            expect(repository.findLocalUserByUsername).toHaveBeenCalledWith('fulano');
            expect(repository.findUserAuthorization).toHaveBeenCalledWith(42);
        });

        it('should NOT fall back to local login when the AD service itself is unavailable', async () => {
            const ldapAuthenticator = makeFakeLdap({ authenticate: jest.fn().mockRejectedValue(new Error('connect ETIMEDOUT')) });
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository, ldapAuthenticator });

            await expect(useCases.login('fulano', 'x')).rejects.toThrow(AppError);
            expect(repository.findLocalUserByUsername).not.toHaveBeenCalled();
        });
    });

    describe('local login', () => {
        it('should throw UnauthorizedError when the user does not exist locally', async () => {
            const ldapAuthenticator = makeFakeLdap({ authenticate: jest.fn().mockRejectedValue(new Error('Invalid Credentials')) });
            const repository = makeFakeRepository({ findLocalUserByUsername: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ repository, ldapAuthenticator });

            await expect(useCases.login('ninguem', 'x')).rejects.toThrow(UnauthorizedError);
        });

        it('should throw UnauthorizedError for a wrong password', async () => {
            const ldapAuthenticator = makeFakeLdap({ authenticate: jest.fn().mockRejectedValue(new Error('Invalid Credentials')) });
            const localHash = (await bcrypt.hash('senhaCerta', 10)).replace('$2b$', '$2y$');
            const repository = makeFakeRepository({
                findLocalUserByUsername: jest.fn().mockResolvedValue({ id: 42, password: localHash }),
            });
            const useCases = makeUseCases({ repository, ldapAuthenticator });

            await expect(useCases.login('fulano', 'senhaErrada')).rejects.toThrow(UnauthorizedError);
        });
    });

    describe('_buildSessionUser', () => {
        it('should enrich the session payload with protheus organization data', async () => {
            const protheusRepository = makeFakeProtheusRepository({
                findUserOrganization: jest.fn().mockResolvedValue({ M0_NOMECOM: 'Acme' }),
            });
            const useCases = makeUseCases({ protheusRepository });

            const result = await useCases.login('fulano', 'senha123');

            expect(protheusRepository.findUserOrganization).toHaveBeenCalledWith('123');
            expect(result.company_name).toBe('Acme');
        });
    });
});

describe('getPhotoFileId', () => {
    it('repassa o id do usuário para a porta', async () => {
        const repository = makeFakeRepository({ findPhotoFileId: jest.fn().mockResolvedValue(1842) });
        const useCases = makeUseCases({ repository });

        await expect(useCases.getPhotoFileId(397)).resolves.toBe(1842);
        expect(repository.findPhotoFileId).toHaveBeenCalledWith(397);
    });

    it('devolve null quando não há foto ativa', async () => {
        const repository = makeFakeRepository({ findPhotoFileId: jest.fn().mockResolvedValue(null) });

        await expect(makeUseCases({ repository }).getPhotoFileId(397)).resolves.toBeNull();
    });
});
