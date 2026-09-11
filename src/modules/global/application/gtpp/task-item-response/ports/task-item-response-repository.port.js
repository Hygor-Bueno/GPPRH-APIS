/**
 * @fileoverview Porta (contrato) de persistência — sub-feature Task Item Response (GTPP).
 * @module modules/global/application/gtpp/task-item-response/ports/task-item-response-repository.port
 */

class TaskItemResponseRepositoryPort {
    /** @param {number} taskItemId @returns {Promise<object[]>} Linhas de `gt_task_item_response` (sem anexos). */
    findByItem(taskItemId) { throw new Error('Not implemented'); }

    /**
     * Anexos ativos de todos os comentários ativos do item, em lista achatada
     * (cada linha traz `task_item_response_id_fk` para o shaper agrupar).
     * @param {number} taskItemId @returns {Promise<object[]>}
     */
    findFilesByItem(taskItemId) { throw new Error('Not implemented'); }

    /** @param {number} responseId @returns {Promise<object[]>} Anexos ativos de UM comentário. */
    findFilesByResponse(responseId) { throw new Error('Not implemented'); }

    /** @param {number} responseId @returns {Promise<object|null>} Comentário ativo, ou null. */
    findResponseById(responseId) { throw new Error('Not implemented'); }

    /**
     * Salva os arquivos recebidos (zero ou mais) e insere o comentário em
     * transação, com uma linha em `gt_task_item_response_files` por arquivo.
     * Se a inserção falhar depois dos arquivos terem sido salvos, todos são
     * soft-deletados para evitar registros órfãos em `_files`.
     *
     * @param {number} taskItemId @param {number} userId
     * @param {{comment:string, files:Express.Multer.File[]}} data
     * @returns {Promise<{responseId:number, files:object[]}>}
     */
    create(taskItemId, userId, data) { throw new Error('Not implemented'); }

    /** @param {number} responseId @param {string} comment @returns {Promise<{affectedRows:number}>} */
    update(responseId, comment) { throw new Error('Not implemented'); }

    /**
     * Soft-delete do comentário; os anexos acompanham o pai (cascata).
     * @param {number} responseId @param {number} userId @returns {Promise<{affectedRows:number}>}
     */
    softDelete(responseId, userId) { throw new Error('Not implemented'); }

    /**
     * Soft-delete de UM anexo (`status = 0`), sem afetar os demais do mesmo
     * comentário. O escopo item → comentário → anexo é validado no próprio
     * UPDATE: fora dele, `affectedRows` volta 0.
     *
     * @param {{attachmentId:number, responseId:number, taskItemId:number, userId:number}} params
     * @returns {Promise<{affectedRows:number}>}
     */
    softDeleteFile(params) { throw new Error('Not implemented'); }

    /** @param {number} itemId @returns {Promise<number|null>} */
    findTaskIdByItemId(itemId) { throw new Error('Not implemented'); }
}

module.exports = { TaskItemResponseRepositoryPort };
