/**
 * @fileoverview Casos de uso — Message GTPP (chat de tarefa).
 * @module modules/global/application/gtpp/message/gtpp-message.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');

const EV_MESSAGE         = 1;
const EV_MESSAGE_DELETED = 10;

class GtppMessageUseCases {
    /**
     * @param {{
     *   repository: import('./ports/message-repository.port').MessageRepositoryPort,
     *   eventPublisher: import('../ports/gtpp-event-publisher.port').GtppEventPublisherPort,
     * }} deps
     */
    constructor({ repository, eventPublisher }) {
        this.repository = repository;
        this.eventPublisher = eventPublisher;
    }

    async getTaskMessages(taskId) {
        return this.repository.findByTask(taskId);
    }

    /**
     * Envia uma mensagem (texto e/ou arquivo).
     * @throws {AppError} 400 se nem texto nem arquivo forem informados
     */
    async sendMessage(taskId, userId, { description, file }) {
        if (!description && !file) {
            throw new AppError('A mensagem precisa ter texto ou arquivo.', 400);
        }

        const message = await this.repository.send(taskId, userId, { description, file });

        this.eventPublisher
            .broadcastEvent(taskId, userId, EV_MESSAGE, { action: 'created', ...message })
            .catch(() => {});

        return message;
    }

    /**
     * Remove uma mensagem da tarefa (delete físico, como no PHP original).
     * @throws {AppError} 404
     */
    async deleteMessage(messageId, taskId, userId) {
        const { affectedRows } = await this.repository.remove(messageId, taskId);
        if (affectedRows === 0) throw new AppError('Mensagem não encontrada.', 404);

        this.eventPublisher
            .broadcastEvent(taskId, userId, EV_MESSAGE_DELETED, { action: 'deleted', id: messageId })
            .catch(() => {});
    }
}

module.exports = { GtppMessageUseCases };
