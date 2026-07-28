/**
 * @fileoverview Porta (contrato) de persistência — sub-feature Task (GTPP).
 * @module modules/global/application/gtpp/task/ports/task-repository.port
 */

class TaskRepositoryPort {
    /** @returns {Promise<Array<{id:number, description:string, color:string}>>} */
    findTaskStates() { throw new Error('Not implemented'); }

    /** @param {number} taskId @returns {Promise<object[]>} */
    findHistoric(taskId) { throw new Error('Not implemented'); }

    /**
     * @param {number} userId
     * @param {{stateId: number|null, limit: number, offset: number}} opts
     * @returns {Promise<{data: object[], hasMore: boolean}>}
     */
    findTasksForUser(userId, opts) { throw new Error('Not implemented'); }

    /** @param {number} taskId @returns {Promise<object|null>} */
    findTaskDetail(taskId) { throw new Error('Not implemented'); }

    /**
     * @param {number} userId
     * @param {{description:string, fullDescription:?string, priority:?number, initialDate:?string, finalDate:?string, themeId:?number}} data
     * @returns {Promise<{taskId:number}>}
     */
    createTask(userId, data) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number} newStateId */
    updateStateDirect(taskId, newStateId) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number} days */
    extendFinalDate(taskId, days) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number} newStateId @param {string} description */
    insertHistoric(taskId, newStateId, description) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {string} title @returns {Promise<{affectedRows:number}>} */
    updateTitle(taskId, title) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {string|null} description @returns {Promise<{affectedRows:number}>} */
    updateDescription(taskId, description) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number|null} themeId @param {number} userId @returns {Promise<{affectedRows:number}>} */
    updateTheme(taskId, themeId, userId) { throw new Error('Not implemented'); }

    /** @param {number} taskId @returns {Promise<{affectedRows:number}>} */
    deleteTask(taskId) { throw new Error('Not implemented'); }
}

module.exports = { TaskRepositoryPort };
