/**
 * @fileoverview Porta (contrato) de persistência — registro de alterações da
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
     *          targetPermissionId:?number, payload:object, previousState:?object,
     *          status:string, requestedBy:number, reviewedBy:?number, reviewNote:?string}} data
     * @returns {Promise<number>} id do registro
     */
    insertRequest(data) { throw new Error('Not implemented'); }

    /** A alteração falhou ao ser aplicada. @param {number} id */
    deleteRequest(id) { throw new Error('Not implemented'); }

    /**
     * Tira o registro de `pending` de forma atômica.
     * @param {number} id @param {string} status @param {number} reviewedBy @param {?string} note
     * @returns {Promise<boolean>} false se outro já tinha tirado
     */
    claimRequest(id, status, reviewedBy, note) { throw new Error('Not implemented'); }

    /** Volta para `pending` (desfazer a alteração falhou). @param {number} id */
    releaseRequest(id) { throw new Error('Not implemented'); }

    /**
     * Ids do que a alteração criou; `undefined`/`null` mantém o que havia.
     * @param {number} id
     * @param {{targetUserId?:number, targetRoleId?:number, targetPermissionId?:number}} targets
     */
    setTargets(id, targets) { throw new Error('Not implemented'); }

    /** @param {number} id @param {object} result */
    setRevertResult(id, result) { throw new Error('Not implemented'); }

    /** @param {string} username @returns {Promise<boolean>} */
    usernameExists(username) { throw new Error('Not implemented'); }

    /** @returns {Promise<Object.<string, number>>} `{ create_user: 2, ... }` só com os tipos que têm pendente */
    countPendingByType() { throw new Error('Not implemented'); }

    /** Usuários ativos com `SYSTEM_OWNER` ou `ACCESS_APPROVE`. @returns {Promise<number[]>} */
    findReviewerIds() { throw new Error('Not implemented'); }

    /** Papéis que têm a permissão de código `code`. @param {string} code @returns {Promise<number[]>} */
    findRoleIdsWithPermission(code) { throw new Error('Not implemented'); }

    /** @param {string} code @returns {Promise<?number>} */
    findPermissionIdByCode(code) { throw new Error('Not implemented'); }
}

module.exports = { AccessRequestRepositoryPort };
