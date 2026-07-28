/**
 * @fileoverview Controller de respostas/evidências de itens GTPP.
 * @module modules/global/controllers/gtpp-task-item-response.controller
 */

'use strict';

const { respond } = require('../../../utils/respond');
const { GtppTaskItemResponseUseCases } = require('../application/gtpp/task-item-response/gtpp-task-item-response.use-cases');
const { MysqlTaskItemResponseRepository } = require('../infrastructure/gtpp/mysql-task-item-response.repository');
const { HttpGtppEventPublisher } = require('../infrastructure/gtpp/http-gtpp-event.publisher');

const useCases = new GtppTaskItemResponseUseCases({
    repository: new MysqlTaskItemResponseRepository(),
    eventPublisher: new HttpGtppEventPublisher(),
});

/**
 * GET /gtpp/items/:itemId/responses
 * Lista todas as respostas ativas de um item.
 */
async function getItemResponses(req, res) {
    const taskItemId = parseInt(req.params.itemId, 10);
    const responses = await useCases.getItemResponses(taskItemId);
    return respond.ok(res, responses);
}

/**
 * POST /gtpp/items/:itemId/responses
 * Adiciona uma resposta/evidência a um item. Aceita arquivo opcional.
 * Body: { comment }
 * File:  campo `file` (opcional, multipart/form-data)
 * Evento WS tipo 7 — novo comentário/evidência.
 */
async function createItemResponse(req, res) {
    const taskItemId = parseInt(req.params.itemId, 10);

    const { comment } = req.body;
    if (req.file) {
        req.file.originalname = req.body.file_name
            ?? Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    }

    const result = await useCases.createItemResponse(taskItemId, req.user.id, {
        comment,
        file: req.file ?? null,
    });

    return respond.created(res, result);
}

/**
 * PUT /gtpp/items/:itemId/responses/:id
 * Atualiza o comentário de uma resposta.
 * Body: { comment }
 * Evento WS tipo 10 — comentário editado.
 */
async function updateItemResponse(req, res) {
    const responseId = parseInt(req.params.id, 10);
    const taskItemId = parseInt(req.params.itemId, 10);
    const { comment } = req.body;

    await useCases.updateItemResponse(responseId, comment, taskItemId, req.user.id);

    return respond.message(res, 'Resposta atualizada com sucesso.');
}

/**
 * DELETE /gtpp/items/:itemId/responses/:id
 * Soft-delete de uma resposta (status = 0).
 * Evento WS tipo 9 — comentário deletado.
 */
async function deleteItemResponse(req, res) {
    const responseId = parseInt(req.params.id, 10);
    const taskItemId = parseInt(req.params.itemId, 10);

    await useCases.deleteItemResponse(responseId, taskItemId, req.user.id);

    return respond.message(res, 'Resposta excluída com sucesso.');
}

module.exports = {
    getItemResponses,
    createItemResponse,
    updateItemResponse,
    deleteItemResponse,
};
