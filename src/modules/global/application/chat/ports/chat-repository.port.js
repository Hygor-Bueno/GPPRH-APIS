/**
 * @fileoverview Porta (contrato) de persistência para o chat direto.
 *
 * Define o que `ChatUseCases` precisa de um repositório, sem conhecer a
 * tecnologia de acesso a dado por trás (hoje: MySQL cru via `mysql2`).
 *
 * @module modules/global/application/chat/ports/chat-repository.port
 */

class ChatRepositoryPort {
    /**
     * @param {number} pageSize - Tamanho de página usado na paginação de mensagens.
     */
    constructor(pageSize = 20) {
        this.pageSize = pageSize;
    }

    /** @param {number} userId */
    findConversations(userId) { throw new Error('Not implemented'); }

    /**
     * @param {number} userId
     * @param {number} partnerId
     * @returns {Promise<number>} Total de mensagens entre os dois usuários.
     */
    countMessages(userId, partnerId) { throw new Error('Not implemented'); }

    /**
     * @param {number} userId
     * @param {number} partnerId
     * @param {number} offset
     */
    findMessages(userId, partnerId, offset) { throw new Error('Not implemented'); }

    /** @param {import('../../../domain/chat/chat-message.entity').ChatMessageEntity} entity */
    insertMessage(entity) { throw new Error('Not implemented'); }

    /** @param {number} id */
    findMessageById(id) { throw new Error('Not implemented'); }

    /**
     * @param {number} currentUserId
     * @param {number} partnerId
     * @returns {Promise<{updated: number}>}
     */
    markAsRead(currentUserId, partnerId) { throw new Error('Not implemented'); }
}

module.exports = { ChatRepositoryPort };
