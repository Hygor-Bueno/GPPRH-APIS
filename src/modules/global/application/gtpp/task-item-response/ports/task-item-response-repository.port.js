/**
 * @fileoverview Porta (contrato) de persistência — sub-feature Task Item Response (GTPP).
 * @module modules/global/application/gtpp/task-item-response/ports/task-item-response-repository.port
 */

class TaskItemResponseRepositoryPort {
    /** @param {number} taskItemId @returns {Promise<object[]>} */
    findByItem(taskItemId) { throw new Error('Not implemented'); }

    /**
     * Salva o arquivo opcional (se houver) e insere a resposta em transação.
     * Se a inserção falhar após o arquivo ter sido salvo, o arquivo é
     * soft-deletado para evitar um registro órfão em `_files`.
     * @param {number} taskItemId @param {number} userId
     * @param {{comment:string, file:?Express.Multer.File}} data
     * @returns {Promise<{responseId:number}>}
     */
    create(taskItemId, userId, data) { throw new Error('Not implemented'); }

    /** @param {number} responseId @param {string} comment @returns {Promise<{affectedRows:number}>} */
    update(responseId, comment) { throw new Error('Not implemented'); }

    /** @param {number} responseId @returns {Promise<{affectedRows:number}>} */
    softDelete(responseId) { throw new Error('Not implemented'); }

    /** @param {number} itemId @returns {Promise<number|null>} */
    findTaskIdByItemId(itemId) { throw new Error('Not implemented'); }
}

module.exports = { TaskItemResponseRepositoryPort };
