/**
 * @fileoverview Porta (contrato) de persistência MySQL — Auth.
 * @module modules/global/application/auth/ports/auth-repository.port
 */

class AuthRepositoryPort {
    /**
     * Chama `sp_get_user_authorization`. Lança erro se o usuário não tiver
     * permissão atribuída.
     * @param {string|number} identifier - GUID do AD ou id local.
     * @returns {Promise<object>}
     */
    findUserAuthorization(identifier) { throw new Error('Not implemented'); }

    /** @param {string} username @returns {Promise<object|null>} */
    findLocalUserByUsername(username) { throw new Error('Not implemented'); }

    /** @param {string} adGuid @returns {Promise<object|null>} */
    findUserByAdGuid(adGuid) { throw new Error('Not implemented'); }

    /**
     * Chama `sp_ad_login_user` — cria ou atualiza o usuário local mapeado ao AD.
     * @param {import('../../../domain/user.entity').User} user
     * @returns {Promise<object>}
     */
    upsertAdLogin(user) { throw new Error('Not implemented'); }
}

module.exports = { AuthRepositoryPort };
