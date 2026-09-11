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

/** Máximo de anexos aceitos em um comentário — espelhado no `maxCount` do multer na rota. */
const MAX_RESPONSE_FILES = 10;

/**
 * Nome de arquivo informado pelo cliente. Aceita `file_names` (novo, repetido
 * ou array) e `file_name` (formato antigo, um único valor). Sempre devolve
 * array, para casar posicionalmente com os arquivos recebidos.
 *
 * @param {*} raw
 * @returns {string[]}
 */
function normalizeNames(raw) {
    if (raw === undefined || raw === null) return [];
    return Array.isArray(raw) ? raw : [raw];
}

/**
 * Achata o `req.files` do multer `.fields()` em uma lista única e resolve o
 * nome original de cada arquivo.
 *
 * O campo `file` (singular) continua sendo aceito — é o que o front manda
 * hoje. @deprecated: quando todas as telas migrarem para `files`, remover o
 * campo da rota e daqui.
 *
 * @param {import('express').Request} req
 * @returns {Express.Multer.File[]}
 */
function collectUploadedFiles(req) {
    const grouped = req.files ?? {};
    const uploaded = [...(grouped.files ?? []), ...(grouped.file ?? [])];

    const names = normalizeNames(req.body.file_names ?? req.body.file_name);

    uploaded.forEach((file, index) => {
        file.originalname = names[index]
            ?? Buffer.from(file.originalname, 'latin1').toString('utf8');
    });

    return uploaded;
}

/**
 * GET /gtpp/items/:itemId/responses
 * Lista todas as respostas ativas de um item, cada uma com `files[]`.
 */
async function getItemResponses(req, res) {
    const taskItemId = parseInt(req.params.itemId, 10);
    const responses = await useCases.getItemResponses(taskItemId);
    return respond.ok(res, responses);
}

/**
 * POST /gtpp/items/:itemId/responses
 * Adiciona uma resposta/evidência a um item. Aceita N arquivos.
 * Body: { comment, file_names? }
 * File:  campo `files` (0..N) — ou `file` (1), formato antigo ainda aceito
 * Evento WS tipo 7 — novo comentário/evidência.
 */
async function createItemResponse(req, res) {
    const taskItemId = parseInt(req.params.itemId, 10);

    const { comment } = req.body;

    const result = await useCases.createItemResponse(taskItemId, req.user.id, {
        comment,
        files: collectUploadedFiles(req),
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
 * Soft-delete de uma resposta (status = 0) e, em cascata, dos seus anexos.
 * Evento WS tipo 9 — comentário deletado.
 */
async function deleteItemResponse(req, res) {
    const responseId = parseInt(req.params.id, 10);
    const taskItemId = parseInt(req.params.itemId, 10);

    await useCases.deleteItemResponse(responseId, taskItemId, req.user.id);

    return respond.message(res, 'Resposta excluída com sucesso.');
}

/**
 * DELETE /gtpp/items/:itemId/responses/:id/files/:attachmentId
 * Soft-delete (status = 0) de UM anexo do comentário, sem afetar os demais.
 * `:attachmentId` é o `id` de `gt_task_item_response_files` (o mesmo devolvido
 * em `files[].id`), não o `file_id` de `_files`.
 * Evento WS tipo 10 — comentário editado.
 */
async function deleteItemResponseFile(req, res) {
    const taskItemId   = parseInt(req.params.itemId, 10);
    const responseId   = parseInt(req.params.id, 10);
    const attachmentId = parseInt(req.params.attachmentId, 10);

    const result = await useCases.deleteItemResponseFile({
        taskItemId, responseId, attachmentId, userId: req.user.id,
    });

    return respond.ok(res, result);
}

module.exports = {
    MAX_RESPONSE_FILES,
    getItemResponses,
    createItemResponse,
    updateItemResponse,
    deleteItemResponse,
    deleteItemResponseFile,
};
