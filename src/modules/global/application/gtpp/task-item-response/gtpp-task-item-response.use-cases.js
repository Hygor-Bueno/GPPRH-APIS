/**
 * @fileoverview Casos de uso — Task Item Response GTPP (respostas/evidências de item).
 *
 * Sem `taskGuardRepository`: esta sub-feature nunca checa editabilidade ou
 * dono da tarefa hoje — preservado como está (não é invariante nova a impor).
 *
 * @module modules/global/application/gtpp/task-item-response/gtpp-task-item-response.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');

// Tipo 7 = novo comentário/evidência | Tipo 9 = comentário deletado | Tipo 10 = comentário editado
const EV_RESPONSE_NEW     = 7;
const EV_RESPONSE_DELETED = 9;
const EV_RESPONSE_UPDATED = 10;

class GtppTaskItemResponseUseCases {
    /**
     * @param {{
     *   repository: import('./ports/task-item-response-repository.port').TaskItemResponseRepositoryPort,
     *   eventPublisher: import('../ports/gtpp-event-publisher.port').GtppEventPublisherPort,
     * }} deps
     */
    constructor({ repository, eventPublisher }) {
        this.repository = repository;
        this.eventPublisher = eventPublisher;
    }

    async getItemResponses(taskItemId) {
        return this.repository.findByItem(taskItemId);
    }

    /**
     * Adiciona uma resposta/evidência a um item. Aceita arquivo opcional.
     * @throws {AppError} 404 se o item não existir / 400 comentário ausente
     */
    async createItemResponse(taskItemId, userId, { comment, file }) {
        const taskId = await this.repository.findTaskIdByItemId(taskItemId);
        if (!taskId) throw new AppError('Item não encontrado.', 404);

        if (!comment || !comment.trim()) throw new AppError('O comentário é obrigatório.', 400);

        const result = await this.repository.create(taskItemId, userId, { comment: comment.trim(), file });

        this.eventPublisher
            .broadcastEvent(taskId, userId, EV_RESPONSE_NEW, {
                action: 'created', id: result.responseId, item_id: taskItemId, comment,
            })
            .catch(() => {});

        return result;
    }

    /** @throws {AppError} 400/404 */
    async updateItemResponse(responseId, comment, taskItemId, userId) {
        if (!comment || !comment.trim()) throw new AppError('O comentário é obrigatório.', 400);

        const { affectedRows } = await this.repository.update(responseId, comment.trim());
        if (affectedRows === 0) throw new AppError('Resposta não encontrada ou já excluída.', 404);

        const taskId = await this.repository.findTaskIdByItemId(taskItemId);
        if (taskId) {
            this.eventPublisher
                .broadcastEvent(taskId, userId, EV_RESPONSE_UPDATED, {
                    action: 'updated', id: responseId, item_id: taskItemId, comment,
                })
                .catch(() => {});
        }
    }

    /** @throws {AppError} 404 */
    async deleteItemResponse(responseId, taskItemId, userId) {
        // Busca o task_id ANTES de deletar, para ainda conseguir emitir o evento.
        const taskId = await this.repository.findTaskIdByItemId(taskItemId);

        const { affectedRows } = await this.repository.softDelete(responseId);
        if (affectedRows === 0) throw new AppError('Resposta não encontrada.', 404);

        if (taskId) {
            this.eventPublisher
                .broadcastEvent(taskId, userId, EV_RESPONSE_DELETED, {
                    action: 'deleted', id: responseId, item_id: taskItemId,
                })
                .catch(() => {});
        }
    }
}

module.exports = { GtppTaskItemResponseUseCases };
