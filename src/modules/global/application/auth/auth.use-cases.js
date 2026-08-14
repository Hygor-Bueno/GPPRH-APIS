/**
 * @fileoverview Casos de uso — Auth (login via AD com fallback local).
 * @module modules/global/application/auth/auth.use-cases
 */

const { AppError } = require('../../../../errors/app.error');
const { UnauthorizedError } = require('../../../../errors/unauthorized.error');
const { User } = require('../../domain/user.entity');
const { verifyPassword, hashPassword } = require('../../domain/auth/password.utils');
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

    /**
     * Troca a senha do próprio usuário autenticado.
     *
     * ⚠️ Só funciona para usuário LOCAL (sem `ad_guid`). Para usuário de AD a
     * senha do banco é apenas um espelho: o `_loginViaAd` a sobrescreve a cada
     * login bem-sucedido, e o AD é tentado antes do cadastro local. Alterá-la
     * aqui não mudaria nada no login e daria ao usuário uma falsa confirmação —
     * por isso recusamos explicitamente em vez de gravar.
     *
     * @param {number} userId          - `req.user.id` (nunca vem do body)
     * @param {string} currentPassword
     * @param {string} newPassword
     * @throws {AppError} 400 se for usuário de AD ou a nova senha for igual à atual
     * @throws {UnauthorizedError} se a senha atual não conferir
     */
    async changeOwnPassword(userId, currentPassword, newPassword) {
        const account = await this.repository.findCredentialsById(userId);
        if (!account) throw new UnauthorizedError('Usuário não encontrado');

        if (account.ad_guid) {
            throw new AppError(
                'Sua senha é gerenciada pelo Active Directory. Altere-a pelo Windows — a troca por aqui não teria efeito.',
                400
            );
        }

        if (!account.password) {
            throw new AppError('Usuário sem senha local cadastrada. Procure o administrador.', 400);
        }

        if (!(await verifyPassword(currentPassword, account.password))) {
            throw new UnauthorizedError('Senha atual incorreta');
        }

        if (currentPassword === newPassword) {
            throw new AppError('A nova senha deve ser diferente da atual', 400);
        }

        await this.repository.updatePassword(userId, await hashPassword(newPassword));
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
