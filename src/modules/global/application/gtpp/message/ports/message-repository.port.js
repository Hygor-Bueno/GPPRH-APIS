/**
 * @fileoverview Porta (contrato) de persistência — sub-feature Message (GTPP).
 * @module modules/global/application/gtpp/message/ports/message-repository.port
 */

class MessageRepositoryPort {
    /** @param {number} taskId @returns {Promise<object[]>} */
    findByTask(taskId) { throw new Error('Not implemented'); }

    /**
     * Envia uma mensagem (texto e/ou arquivo). Se o arquivo tiver sido salvo e a
     * gravação da mensagem falhar em seguida, o arquivo é soft-deletado para não
     * ficar órfão em `_files`.
     * @param {number} taskId @param {number} userId
     * @param {{description:?string, file:?Express.Multer.File}} data
     * @returns {Promise<object>} a mensagem recém-criada, já formatada
     */
    send(taskId, userId, data) { throw new Error('Not implemented'); }

    /** @param {number} messageId @param {number} taskId @returns {Promise<{affectedRows:number}>} */
    remove(messageId, taskId) { throw new Error('Not implemented'); }
}

module.exports = { MessageRepositoryPort };
