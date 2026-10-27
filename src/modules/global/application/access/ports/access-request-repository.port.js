/**
 * @fileoverview Porta (contrato) de persistência — fila de aprovação da
 * Gestão de Acessos (`_access_requests`).
 * @module modules/global/application/access/ports/access-request-repository.port
 */

class AccessRequestRepositoryPort {
    /**
     * @param {{status:?string, type:?string, requestedBy:?number, targetUserId:?number}} filters
     * @param {{limit:number, offset:number}} page
     * @returns {Promise<{rows: object[], total: number}>}
     */
    findRequests(filters, page) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<object|null>} */
    findRequestById(id) { throw new Error('Not implemented'); }

    /**
     * @param {{type:string, targetUserId:?number, targetRoleId:?number,
     *          targetPermissionId:?number, payload:object, requestedBy:number}} data
     * @returns {Promise<number>} id do pedido
     */
    insertRequest(data) { throw new Error('Not implemented'); }

    /**
     * Tira o pedido de `pending` de forma atômica.
     * @param {number} id @param {string} status @param {number} reviewedBy @param {?string} note
     * @returns {Promise<boolean>} false se outro já tinha tirado
     */
    claimRequest(id, status, reviewedBy, note) { throw new Error('Not implemented'); }

    /** Volta para `pending` (a mudança aprovada falhou ao ser aplicada). @param {number} id */
    releaseRequest(id) { throw new Error('Not implemented'); }

    /** @param {number} id @param {number} userId */
    setTargetUser(id, userId) { throw new Error('Not implemented'); }

    /** @param {string} username @returns {Promise<boolean>} */
    usernameExists(username) { throw new Error('Not implemented'); }

    /** @param {string} username @returns {Promise<boolean>} */
    hasPendingCreateUser(username) { throw new Error('Not implemented'); }

    /** @returns {Promise<Object.<string, number>>} `{ create_user: 2, ... }` só com os tipos que têm pendente */
    countPendingByType() { throw new Error('Not implemented'); }

    /** Usuários ativos com `SYSTEM_OWNER`. @returns {Promise<number[]>} */
    findApproverIds() { throw new Error('Not implemented'); }
}

module.exports = { AccessRequestRepositoryPort };
