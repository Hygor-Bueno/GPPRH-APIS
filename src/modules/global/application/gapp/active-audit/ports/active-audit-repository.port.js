/**
 * @fileoverview Porta (contrato) de persistência da auditoria de ativos GAPP.
 *
 * Toda escrita depois da abertura passa por `runLocked`: a linha da auditoria
 * fica travada (`FOR UPDATE`) até o fim da função, o que serializa conferência,
 * finalização e cancelamento da mesma auditoria — inclusive entre as 2
 * instâncias da API no cluster.
 *
 * @module modules/global/application/gapp/active-audit/ports/active-audit-repository.port
 */

class ActiveAuditRepositoryPort {
    /**
     * @param {number[]} activeIds
     * @param {number} workGroupFk
     * @returns {Promise<object[]>} linhas de gapp_active (só do grupo)
     */
    findActivesForSnapshot(activeIds, workGroupFk) { throw new Error('Not implemented'); }

    /**
     * @param {{ user_open_id_fk: number, initial_data: object, quantity_active: number }} data
     * @returns {Promise<{ insertId: number }>}
     */
    createAudit(data) { throw new Error('Not implemented'); }

    /** @param {object} filters inclui `work_group_fk` */
    list(filters) { throw new Error('Not implemented'); }

    /**
     * @param {number} auditId
     * @param {number} workGroupFk
     * @returns {Promise<object|null>} com `initial_data`/`final_data` já como objeto
     */
    findById(auditId, workGroupFk) { throw new Error('Not implemented'); }

    /** @param {number} auditId @returns {Promise<object[]>} */
    listItems(auditId) { throw new Error('Not implemented'); }

    /**
     * Registros de auditorias finalizadas (exceto `auditId`) com os mesmos identificadores.
     * @param {number} auditId
     * @param {Array<[string, string]>} pairs
     */
    findIdentifierHistory(auditId, pairs) { throw new Error('Not implemented'); }

    /**
     * Executa `fn(tx)` numa transação com a auditoria travada.
     * `tx.audit` = { audit_id, status_audit, initial_data } ou `null` se não existir.
     * `tx` expõe: findItem, findItemByIdentifier, insertItem, updateItem,
     * updateStatus, listItems, findIdentifierHistory, closeAudit.
     *
     * @template T
     * @param {number} auditId
     * @param {(tx: object) => Promise<T>} fn
     * @returns {Promise<T>}
     */
    runLocked(auditId, fn) { throw new Error('Not implemented'); }
}

module.exports = { ActiveAuditRepositoryPort };
