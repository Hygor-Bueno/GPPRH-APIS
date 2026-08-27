/**
 * @fileoverview Porta (contrato) compartilhada entre Task e Task Item —
 * consulta estado/dono/progresso de uma tarefa sem conhecer a regra que
 * decide o que fazer com esses dados (isso fica no domínio/use-case).
 *
 * @module modules/global/application/gtpp/ports/gtpp-task-guard-repository.port
 */

class GtppTaskGuardRepositoryPort {
    /** @param {number} taskId @returns {Promise<{stateId: number, creatorId: number}|null>} */
    findStateAndCreator(taskId) { throw new Error('Not implemented'); }

    /** @param {number} taskId @returns {Promise<{total: number, checked: number}>} */
    findItemStats(taskId) { throw new Error('Not implemented'); }

    /**
     * Aplica a transição (update direto + histórico) numa única operação.
     * @param {number} taskId
     * @param {number} newStateId
     * @param {string} historyDescription
     */
    applyStateTransition(taskId, newStateId, historyDescription) { throw new Error('Not implemented'); }
}

module.exports = { GtppTaskGuardRepositoryPort };
