/**
 * @fileoverview Porta (contrato) de persistência — sub-feature Task Scope (GTPP).
 * @module modules/global/application/gtpp/task-scope/ports/task-scope-repository.port
 */

class TaskScopeRepositoryPort {
    /** @param {number} taskId @returns {Promise<object[]>} */
    findByTask(taskId) { throw new Error('Not implemented'); }

    /**
     * @param {number} taskId
     * @param {{company_code:?string, branch_code:?string, cost_center_code:?string}} data
     * @returns {Promise<{id:number}>}
     */
    insert(taskId, data) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number} scopeId @returns {Promise<{affectedRows:number}>} */
    remove(taskId, scopeId) { throw new Error('Not implemented'); }
}

module.exports = { TaskScopeRepositoryPort };
