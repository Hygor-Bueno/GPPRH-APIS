/**
 * @fileoverview Porta de acesso a dados de usuário/candidato do gpprh (MySQL, poolGpprh).
 *
 * `getGlobalUser`, `getCandidates` e `spGlobalAdLogin` existiam no service
 * original mas não tinham nenhum consumidor (nenhuma rota os chamava) —
 * confirmado por grep no `src` inteiro antes da migração. Não portados,
 * seguindo o mesmo critério de código morto usado na suite GTPP.
 *
 * @module modules/gpprh/application/ports/gpprh-repository.port
 */

class GpprhRepositoryPort {
    /** @param {string} identifier */
    async getUser(identifier) { throw new Error('Not implemented'); }

    /**
     * @param {string} identifier
     * @param {string} name
     * @param {string|null} email
     */
    async spAdLogin(identifier, name, email = null) { throw new Error('Not implemented'); }

    /**
     * @param {string} name
     * @param {string} email
     */
    async spCandidateLogin(name, email) { throw new Error('Not implemented'); }
}

module.exports = { GpprhRepositoryPort };
