/**
 * @fileoverview Porta (contrato) de leitura — sub-feature Task Dossier (GTPP).
 * @module modules/global/application/gtpp/task-dossier/ports/task-dossier-repository.port
 */

class TaskDossierRepositoryPort {
    /**
     * Tudo o que o dossiê mostra de uma tarefa, em linhas cruas. Implementações
     * devem buscar cada bloco da tarefa inteira de uma vez (sem ida por item).
     *
     * @param {number} taskId
     * @param {{messageLimit: number}} opts - quantas mensagens recentes do chat trazer.
     * @returns {Promise<{
     *   task: object, participants: object[], items: object[], responses: object[],
     *   responseFiles: object[], messages: object[], messagesTotal: number,
     *   history: object[], scope: object[], legacyScope: object[],
     * }|null>} `null` se a tarefa não existir.
     */
    findDossierData(taskId, opts) { throw new Error('Not implemented'); }

    /** @param {number} userId @returns {Promise<{id: number, name: string}|null>} */
    findViewer(userId) { throw new Error('Not implemented'); }
}

module.exports = { TaskDossierRepositoryPort };
