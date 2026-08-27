/**
 * @fileoverview Casos de uso do Chat Direto.
 *
 * Orquestra domínio + porta de repositório + porta de publicação de eventos,
 * sem saber qual banco ou qual mecanismo de entrega de evento está por trás.
 * Único ponto de orquestração consumido tanto pelo controller REST quanto
 * pelo handler WebSocket (`websocket/events/chat.event.js`).
 *
 * @module modules/global/application/chat/chat.use-cases
 */

const { AppError } = require('../../../../errors/app.error');
const { ChatMessageEntity } = require('../../domain/chat/chat-message.entity');

class ChatUseCases {
    /**
     * @param {Object} deps
     * @param {import('./ports/chat-repository.port').ChatRepositoryPort} deps.repository
     * @param {import('./ports/chat-event-publisher.port').ChatEventPublisherPort} deps.eventPublisher
     */
    constructor({ repository, eventPublisher }) {
        this.repository = repository;
        this.eventPublisher = eventPublisher;
    }

    /**
     * @param {number} userId
     * @returns {Promise<Object[]>}
     */
    async getConversations(userId) {
        return this.repository.findConversations(userId);
    }

    /**
     * @param {number} userId
     * @param {number} partnerId
     * @param {number} [page=1]
     * @returns {Promise<{messages: Object[], total: number, page: number, pages: number}>}
     */
    async getMessages(userId, partnerId, page = 1) {
        const pageNum = parseInt(page, 10);
        if (isNaN(pageNum) || pageNum < 1) {
            throw new AppError('Parâmetro `page` inválido.', 400);
        }

        const pageSize = this.repository.pageSize;
        const offset = (pageNum - 1) * pageSize;

        const total = await this.repository.countMessages(userId, partnerId);
        const pages = Math.ceil(total / pageSize) || 1;
        const messages = await this.repository.findMessages(userId, partnerId, offset);

        return { messages, total, page: pageNum, pages };
    }

    /**
     * @param {Object} params
     * @param {number} params.senderId
     * @param {number} params.recipientId
     * @param {string|null} params.message
     * @param {*} [params.type]
     * @param {number|null} [params.fileId]
     * @param {string|null} [params.fileName]
     * @returns {Promise<Object>} Mensagem persistida.
     */
    async sendMessage({ senderId, recipientId, message, type, fileId = null, fileName = null }) {
        const entity = new ChatMessageEntity({ senderId, recipientId, message, type, fileId, fileName });

        const inserted = await this.repository.insertMessage(entity);
        const saved = await this.repository.findMessageById(inserted.insertId);

        await this.eventPublisher.publishMessageSent(saved);
        return saved;
    }

    /**
     * @param {number} currentUserId
     * @param {number} partnerId
     * @returns {Promise<{updated: number}>}
     */
    async markAsRead(currentUserId, partnerId) {
        const result = await this.repository.markAsRead(currentUserId, partnerId);
        if (result.updated > 0) {
            await this.eventPublisher.publishMessagesRead({ readerId: currentUserId, partnerId });
        }
        return result;
    }
}

module.exports = { ChatUseCases };
