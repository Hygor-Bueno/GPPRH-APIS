/**
 * @fileoverview Porta da trilha de auditoria do meipp.
 *
 * Compartilhada por todas as sub-features (toda escrita administrativa grava
 * uma linha), por isso mora em `application/meipp/ports/` e leva o prefixo da
 * suite.
 *
 * @module modules/global/application/meipp/ports/meipp-audit-repository.port
 */

class MeippAuditRepositoryPort {
    /**
     * @param {object}  entry
     * @param {number|null} entry.userId     - `meipp_users.id` do autor.
     * @param {string}  entry.action         - ex.: `create`, `update`, `delete`.
     * @param {string}  entry.entityType     - ex.: `player`, `playlist`.
     * @param {number|null} entry.entityId
     * @param {object|null} entry.detail     - payload resumido; vira JSON.
     * @returns {Promise<void>}
     */
    record(entry) { throw new Error('Not implemented'); }

    /**
     * @param {object} filters - `{ entityType, userId, limit, offset }`
     * @returns {Promise<{rows: object[], total: number}>}
     */
    list(filters) { throw new Error('Not implemented'); }
}

module.exports = { MeippAuditRepositoryPort };
