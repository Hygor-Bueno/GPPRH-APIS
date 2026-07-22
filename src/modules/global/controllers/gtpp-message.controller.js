/**
 * @fileoverview Controller do chat de tarefa GTPP.
 * @module modules/global/controllers/gtpp-message.controller
 */

'use strict';

const { AppError }           = require('../../../errors/app.error');
const { respond }            = require('../../../utils/respond');
const { broadcastGtppEvent } = require('../../../websocket/events/gtpp.event');
const msgService             = require('../services/gtpp-message.service');

const EV_MESSAGE         = 1;
const EV_MESSAGE_DELETED = 10;

/**
 * GET /gtpp/tasks/:taskId/messages
 * Lista mensagens de uma tarefa.
 * O campo `image` retorna 0 (sem imagem) ou 1 (tem imagem — buscar via GET /gtpp/messages/:id/image).
 */
async function getTaskMessages(req, res) {
    const taskId = parseInt(req.params.taskId, 10);
    const messages = await msgService.getTaskMessages(taskId);
    return respond.ok(res, messages);
}


/**
 * POST /gtpp/tasks/:taskId/messages
 * Envia uma mensagem (texto e/ou imagem Base64).
 * Body: { description?, image? }  — pelo menos um dos dois é obrigatório.
 */
async function sendMessage(req, res) {
    const taskId = parseInt(req.params.taskId, 10);
    const { description } = req.body;

    if (req.file) {
        req.file.originalname = req.body.file_name
            ?? Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    }

    const message = await msgService.sendMessage(taskId, req.user.id, {
        description,
        file: req.file ?? null,
    });

    broadcastGtppEvent(taskId, req.user.id, EV_MESSAGE, { action: 'created', ...message }).catch(() => {});

    return respond.created(res, message);
}

/**
 * DELETE /gtpp/messages/:id
 * Remove uma mensagem (delete físico).
 * Query param: task_id (obrigatório para garantir integridade).
 */
async function deleteMessage(req, res) {
    const messageId = parseInt(req.params.id, 10);
    const taskId    = req.query.task_id ? parseInt(req.query.task_id, 10) : null;

    if (!taskId) throw new AppError('O parâmetro task_id é obrigatório.', 400);

    await msgService.deleteMessage(messageId, taskId);

    broadcastGtppEvent(taskId, req.user.id, EV_MESSAGE_DELETED, {
        action: 'deleted',
        id:     messageId,
    }).catch(() => {});

    return respond.message(res, 'Mensagem excluída com sucesso.');
}

module.exports = {
    getTaskMessages,
    sendMessage,
    deleteMessage,
};
