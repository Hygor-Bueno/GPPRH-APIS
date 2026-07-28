/**
 * @fileoverview Casos de uso — Auth (login via AD com fallback local).
 * @module modules/global/application/auth/auth.use-cases
 */

const { AppError } = require('../../../../errors/app.error');
const { UnauthorizedError } = require('../../../../errors/unauthorized.error');
const { User } = require('../../domain/user.entity');
const { verifyPassword } = require('../../domain/auth/password.utils');
const { mapUserWithOrganization } = require('../../domain/auth/login-payload.mapper');

class AuthUseCases {
    /**
     * @param {{
     *   repository: import('./ports/auth-repository.port').AuthRepositoryPort,
     *   protheusRepository: import('./ports/protheus-employee-repository.port').ProtheusEmployeeRepositoryPort,
     *   ldapAuthenticator: import('./ports/ldap-authenticator.port').LdapAuthenticatorPort,
     * }} deps
     */
    constructor({ repository, protheusRepository, ldapAuthenticator }) {
        this.repository = repository;
        this.protheusRepository = protheusRepository;
        this.ldapAuthenticator = ldapAuthenticator;
    }

    /**
     * Autentica via AD (com fallback pro cadastro local em caso de credenciais
     * inválidas no AD) e retorna o payload de sessão já enriquecido com dados
     * do Protheus.
     * @param {string} username @param {string} password
     * @throws {UnauthorizedError} credenciais inválidas
     * @throws {AppError} 503 se o AD estiver indisponível
     */
    async login(username, password) {
        const loginResult = await this._authenticate(username, password);
        const identifier = loginResult.guid || loginResult.id;
        return this._buildSessionUser(identifier);
    }

    /** @private */
    async _authenticate(username, password) {
        try {
            return await this._loginViaAd(username, password);
        } catch (err) {
            // Se o AD rejeitar (credenciais inválidas ou não mapeado), tenta o cadastro local.
            if (err instanceof UnauthorizedError) {
                return await this._loginViaLocalDb(username, password);
            }
            throw err;
        }
    }

    /** @private */
    async _loginViaLocalDb(username, password) {
        const user = await this.repository.findLocalUserByUsername(username);
        if (!user) throw new UnauthorizedError('Usuário não encontrado');
        if (!(await verifyPassword(password, user.password))) {
            throw new UnauthorizedError('Senha incorreta');
        }
        return user;
    }

    /** @private */
    async _loginViaAd(username, password) {
        try {
            const auth = await this.ldapAuthenticator.authenticate(username, password);

            const existingUser = await this.repository.findUserByAdGuid(auth.guid);

            if (existingUser) {
                // Usuário já mapeado — atualiza senha e retorna sem consultar o Protheus
                const knownUser = new User({
                    user: username,
                    name: existingUser.name,
                    registration: existingUser.registration,
                    branch_code: existingUser.branch_code,
                    table_protheus: existingUser.table_protheus,
                    ad_guid: auth.guid,
                });
                await knownUser.setPassword(password);
                await this.repository.upsertAdLogin(knownUser);
                return auth;
            }

            // Primeiro login — busca dados no Protheus
            const [employee] = await this.protheusRepository.findEmployeeDataByName(auth.name);
            const newUser = new User({
                user: username,
                name: employee['RA_NOME'],
                registration: employee['RA_MAT'],
                branch_code: employee['M0_CODFIL'],
                table_protheus: employee['TABELA'],
                ad_guid: auth.guid,
            });
            await newUser.setPassword(password);
            await this.repository.upsertAdLogin(newUser);
            return auth;
        } catch (err) {
            if (err.message?.includes('Invalid Credentials')) {
                throw new UnauthorizedError('Usuário ou senha inválidos no Active Directory');
            }
            if (err.message?.includes('LDAP') || err.message?.includes('connect')) {
                throw new AppError('Serviço de autenticação (AD) indisponível', 503);
            }
            throw err;
        }
    }

    /** @private */
    async _buildSessionUser(identifier) {
        const userData = await this.repository.findUserAuthorization(identifier);
        const orgData = await this.protheusRepository.findUserOrganization(userData.registration);
        return mapUserWithOrganization(userData, orgData);
    }
}

module.exports = { AuthUseCases };
