/**
 * @fileoverview Porta do cadastro de papéis do painel (`meipp_users`).
 *
 * Compartilhada: a sub-feature de usuários faz o CRUD, e o middleware de papel
 * chama `findByGlobalUserId` em toda requisição administrativa.
 *
 * @module modules/global/application/meipp/ports/meipp-user-repository.port
 */

class MeippUserRepositoryPort {
    /**
     * Resolve o usuário meipp a partir do id da sessão global.
     * @param {number} globalUserId
     * @returns {Promise<object|null>} `null` se não tiver acesso ao módulo.
     */
    findByGlobalUserId(globalUserId) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<object|null>} */
    findById(id) { throw new Error('Not implemented'); }

    /** @param {object} filters @returns {Promise<{rows: object[], total: number}>} */
    list(filters) { throw new Error('Not implemented'); }

    /** @param {object} payload @returns {Promise<number>} id criado */
    create(payload) { throw new Error('Not implemented'); }

    /** @param {number} id @param {object} payload @returns {Promise<void>} */
    update(id, payload) { throw new Error('Not implemented'); }

    /** Desativa (`active = 0`). @param {number} id @returns {Promise<void>} */
    deactivate(id) { throw new Error('Not implemented'); }
}

module.exports = { MeippUserRepositoryPort };
