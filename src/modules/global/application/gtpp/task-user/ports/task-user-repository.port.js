/**
 * @fileoverview Porta (contrato) de persistência MySQL para usuários vinculados
 * a tarefas GTPP.
 *
 * @module modules/global/application/gtpp/task-user/ports/task-user-repository.port
 */

class TaskUserRepositoryPort {
    /**
     * Todos os participantes de uma tarefa (criador + vinculados), sem duplicar.
     * @param {number} taskId
     * @returns {Promise<number[]>}
     */
    findAllParticipantIds(taskId) { throw new Error('Not implemented'); }

    /**
     * Todos os usuários com acesso GTPP, indicando quais já estão vinculados à tarefa.
     * @param {number} taskId
     * @returns {Promise<Array<{user_id:number, name:string, check:boolean}>>}
     */
    findTaskUsers(taskId) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number} userId @returns {Promise<boolean>} */
    isUserInTask(taskId, userId) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number} userId */
    addUser(taskId, userId) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number} userId */
    removeUser(taskId, userId) { throw new Error('Not implemented'); }
}

module.exports = { TaskUserRepositoryPort };
