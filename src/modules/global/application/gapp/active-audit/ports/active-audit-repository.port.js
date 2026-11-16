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
     * Ativos do grupo dentro do escopo (unidade, setor, classe, tipo).
     * Com `activeIds` → só esses; sem → todos do escopo, até `limit`.
     * @param {{ scope: object, workGroupFk: number, activeIds?: number[]|null, limit: number }} params
     * @returns {Promise<object[]>} linhas de gapp_active com nomes de classe, tipo, unidade e setor
     */
    findActivesForAudit(params) { throw new Error('Not implemented'); }

    /**
     * Referências por id (só as informadas).
     * @param {{ unit_id_fk?: number, dep_id_fk?: number, id_active_class_fk?: number, active_type_id_fk?: number }} refs
     * @returns {Promise<{ unit: object|null, department: object|null, activeClass: object|null, activeType: object|null }>}
     */
    findRefs(refs) { throw new Error('Not implemented'); }

    /**
     * @param {{ user_open_id_fk: number, unit_id_fk: number, dep_id_fk?: number, id_active_class_fk?: number,
     *           initial_data: object, quantity_active: number }} data
     * @returns {Promise<{ insertId: number }>}
     */
    createAudit(data) { throw new Error('Not implemented'); }

    /** @param {number[]} userIds @returns {Promise<Array<{ user_id: number, name: string }>>} */
    findUserNames(userIds) { throw new Error('Not implemented'); }

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
     * `tx` expõe: findItem, findActiveLocation, findRefs, findItemByIdentifier,
     * insertItem, updateItem, updateStatus, listItems, findIdentifierHistory,
     * closeAudit, getFinalData (relê final_data) e deleteItems (limpa a temporária).
     *
     * @template T
     * @param {number} auditId
     * @param {(tx: object) => Promise<T>} fn
     * @returns {Promise<T>}
     */
    runLocked(auditId, fn) { throw new Error('Not implemented'); }
}

module.exports = { ActiveAuditRepositoryPort };
