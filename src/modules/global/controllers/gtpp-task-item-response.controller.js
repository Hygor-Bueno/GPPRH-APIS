/**
 * @fileoverview Controller de respostas/evidências de itens GTPP.
 * @module modules/global/controllers/gtpp-task-item-response.controller
 */

'use strict';

const { AppError }           = require('../../../errors/app.error');
const { respond }            = require('../../../utils/respond');
const { poolGlobal }         = require('../../../config/mysql');
const { broadcastGtppEvent } = require('../../../websocket/events/gtpp.event');
const responseService        = require('../services/gtpp-task-item-response.service');

// Tipo 7 = novo comentário/evidência | Tipo 9 = comentário deletado | Tipo 10 = comentário editado
const EV_RESPONSE_NEW     = 7;
const EV_RESPONSE_DELETED = 9;
const EV_RESPONSE_UPDATED = 10;

/**
 * GET /gtpp/items/:itemId/responses
 * Lista todas as respostas ativas de um item.
 */
async function getItemResponses(req, res) {
    const taskItemId = parseInt(req.params.itemId, 10);
    const responses = await responseService.getItemResponses(taskItemId);
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

    const [[item]] = await poolGlobal.execute(
        'SELECT task_id FROM gt_task_item WHERE id = ?', [taskItemId]
    );
    if (!item) throw new AppError('Item não encontrado.', 404);

    const { comment } = req.body;
    if (req.file) {
        req.file.originalname = req.body.file_name
            ?? Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    }

    const result = await responseService.createItemResponse(
        item.task_id,
        taskItemId,
        req.user.id,
        {
            comment,
            file: req.file ?? null,
        }
    );

    broadcastGtppEvent(item.task_id, req.user.id, EV_RESPONSE_NEW, {
        action:  'created',
        id:      result.responseId,
        item_id: taskItemId,
        comment,
    }).catch(() => {});

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

    await responseService.updateItemResponse(responseId, comment);

    const [[item]] = await poolGlobal.execute(
        'SELECT task_id FROM gt_task_item WHERE id = ?', [taskItemId]
    );
    if (item?.task_id) {
        broadcastGtppEvent(item.task_id, req.user.id, EV_RESPONSE_UPDATED, {
            action:  'updated',
            id:      responseId,
            item_id: taskItemId,
            comment,
        }).catch(() => {});
    }

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

    // Busca task_id antes de deletar para poder emitir o evento
    const [[item]] = await poolGlobal.execute(
        'SELECT task_id FROM gt_task_item WHERE id = ?', [taskItemId]
    );

    await responseService.deleteItemResponse(responseId);

    if (item?.task_id) {
        broadcastGtppEvent(item.task_id, req.user.id, EV_RESPONSE_DELETED, {
            action:  'deleted',
            id:      responseId,
            item_id: taskItemId,
        }).catch(() => {});
    }

    return respond.message(res, 'Resposta excluída com sucesso.');
}

module.exports = {
    getItemResponses,
    createItemResponse,
    updateItemResponse,
    deleteItemResponse,
};
