/**
 * @fileoverview Porta (contrato) de resolução de usuário GAPP.
 *
 * Compartilhada entre Active e Expenses — ambos precisam mapear o usuário
 * autenticado (JWT) para seu `user_id`/`work_group_fk` no GAPP.
 *
 * @module modules/global/application/gapp/ports/gapp-user-repository.port
 */

class GappUserRepositoryPort {
    /**
     * @param {number} accessCode - `_user.id` do usuário autenticado.
     * @returns {Promise<{user_id: number, work_group_fk: number}|null>}
     */
    findAuthByAccessCode(accessCode) { throw new Error('Not implemented'); }
}

module.exports = { GappUserRepositoryPort };
