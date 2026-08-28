const { AppError } = require('../../../errors/app.error');

/**
 * @fileoverview Orquestração de login do módulo gpprh (AD e Google).
 * @module modules/gpprh/application/gpprh-login.use-cases
 */
class GpprhLoginUseCases {
    /**
     * @param {{
     *   repository: import('./ports/gpprh-repository.port').GpprhRepositoryPort,
     *   ldapAuthenticator: import('./ports/ldap-authenticator.port').LdapAuthenticatorPort,
     *   googleTokenVerifier: import('./ports/google-token-verifier.port').GoogleTokenVerifierPort,
     * }} deps
     */
    constructor({ repository, ldapAuthenticator, googleTokenVerifier }) {
        this.repository = repository;
        this.ldapAuthenticator = ldapAuthenticator;
        this.googleTokenVerifier = googleTokenVerifier;
    }

    async loginViaAd(username, password) {
        const auth = await this.ldapAuthenticator.authenticate(username, password);
        await this.repository.spAdLogin(auth.guid, auth.name);
        return this.repository.getUser(auth.guid);
    }

    async loginViaGoogle(credential) {
        const payload = await this.googleTokenVerifier.verify(credential);

        if (!payload?.email) {
            throw new AppError('Dados do Google inválidos.', 401, { code: 'GOOGLE_AUTH_INVALID' });
        }

        const user = await this.repository.spCandidateLogin(payload.name, payload.email);
        user.roles = 'CANDIDATE';
        user.permissions = 'CANDIDATE';
        return user;
    }
}

module.exports = { GpprhLoginUseCases };
