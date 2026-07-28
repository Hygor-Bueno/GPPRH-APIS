/**
 * @fileoverview Controller de itens de tarefa GTPP.
 * @module modules/global/controllers/gtpp-task-item.controller
 */

'use strict';

const { AppError } = require('../../../errors/app.error');
const { respond } = require('../../../utils/respond');
const { FileService } = require('../../../utils/file/file.service');
const { GtppTaskItemUseCases } = require('../application/gtpp/task-item/gtpp-task-item.use-cases');
const { MysqlTaskItemRepository } = require('../infrastructure/gtpp/mysql-task-item.repository');
const { MysqlGtppTaskGuardRepository } = require('../infrastructure/gtpp/mysql-gtpp-task-guard.repository');
const { HttpGtppEventPublisher } = require('../infrastructure/gtpp/http-gtpp-event.publisher');

const useCases = new GtppTaskItemUseCases({
    repository: new MysqlTaskItemRepository(),
    taskGuardRepository: new MysqlGtppTaskGuardRepository(),
    eventPublisher: new HttpGtppEventPublisher(),
});

/**
 * GET /gtpp/tasks/:taskId/items
 * Lista todos os itens ativos de uma tarefa.
 */
async function getTaskItems(req, res) {
    const taskId = parseInt(req.params.taskId, 10);
    const items = await useCases.getTaskItems(taskId);
    return respond.ok(res, items);
}

/**
 * POST /gtpp/tasks/:taskId/items
 * Cria um item na tarefa. Aceita arquivo opcional (multipart/form-data).
 * Body: { description, note?, yes_no? }
 * File:  campo `file` (opcional)
 * Evento WS tipo 2 — item criado.
 */
async function createTaskItem(req, res) {
    const taskId = parseInt(req.params.taskId, 10);

    const { description, note, yes_no, initial_date, final_date } = req.body;
    if (req.file) {
        req.file.originalname = req.body.file_name
            ?? Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    }

    const result = await useCases.createTaskItem(taskId, req.user.id, {
        description,
        file:        req.file ?? null,
        note,
        yesNo:       yes_no,
        initialDate: initial_date ?? null,
        finalDate:   final_date   ?? null,
    });

    return respond.created(res, result);
}

/**
 * PUT /gtpp/tasks/:taskId/items/:id
 * Atualiza um campo específico do item conforme o campo `action`.
 *
 * Ações disponíveis:
 * - `check`       → { check: 0|1 }
 * - `yes_no`      → { yes_no: -1|0|1|2 }
 * - `description` → { description: string }
 * - `file`        → multipart com campo `file`
 * - `note`        → { note: string|null }
 * - `assigned_to` → { assigned_to: number|null }
 * - `status`      → { status: number }
 * - `position`    → { direction: 'up'|'down' }
 * - `dates`       → { initial_date, final_date } — restrito ao dono do item/tarefa ou admin
 *
 * Evento WS tipo 2 — item alterado.
 */
async function updateTaskItem(req, res) {
    const taskId = parseInt(req.params.taskId, 10);
    const itemId = parseInt(req.params.id, 10);
    const { action } = req.body;

    if (!action) throw new AppError('O campo "action" é obrigatório.', 400);
    if (req.file) {
        req.file.originalname = req.body.file_name
            ?? Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    }

    switch (action) {

        case 'check': {
            const checkVal = req.body.check ? 1 : 0;
            await useCases.updateItemCheck(taskId, itemId, checkVal, req.user.id);
            break;
        }

        case 'yes_no': {
            const yesNoVal = Number(req.body.yes_no);
            await useCases.updateItemYesNo(taskId, itemId, yesNoVal, req.user.id);
            break;
        }

        case 'description':
            await useCases.updateItemDescription(taskId, itemId, req.body.description, req.user.id);
            break;

        case 'file':
            await useCases.updateItemFile(taskId, itemId, req.user.id, req.file ?? null);
            break;

        case 'note':
            await useCases.updateItemNote(taskId, itemId, req.body.note ?? null, req.user.id);
            break;

        case 'assigned_to': {
            const assignedTo = req.body.assigned_to ? parseInt(req.body.assigned_to, 10) : null;
            await useCases.updateItemAssignedTo(taskId, itemId, assignedTo, req.user.id);
            break;
        }

        case 'status': {
            const statusVal = Number(req.body.status);
            await useCases.updateItemStatus(taskId, itemId, statusVal, req.user.id);
            break;
        }

        case 'position': {
            const dir = req.body.direction;
            if (!['up', 'down'].includes(dir)) {
                throw new AppError('Direção inválida. Use "up" ou "down".', 400);
            }
            await useCases.updateItemPosition(taskId, itemId, dir, req.user.id);
            break;
        }

        case 'dates': {
            const initialDate = req.body.initial_date ?? null;
            const finalDate   = req.body.final_date   ?? null;
            await useCases.updateItemDates(taskId, itemId, initialDate, finalDate, req.user);
            break;
        }

        default:
            throw new AppError(`Ação desconhecida: "${action}".`, 400);
    }

    return respond.message(res, 'Item atualizado com sucesso.');
}

/**
 * GET /gtpp/tasks/:taskId/items/:id/file
 * Serve o arquivo anexado ao item.
 * Transparente: abstrai arquivo novo (_files) e legado (BLOB).
 */
async function downloadItemFile(req, res) {
    const taskId = parseInt(req.params.taskId, 10);
    const itemId = parseInt(req.params.id, 10);

    const fileInfo = await useCases.getItemFileInfo(itemId);

    if (!fileInfo) {
        throw new AppError('Este item não possui arquivo anexado.', 404);
    }

    if (fileInfo.source === 'files') {
        const record = await FileService.findById(
            await useCases.getItemFileId(taskId, itemId)
        );
        const absolutePath = FileService.absolutePath(record);
        return res.sendFile(absolutePath, err => {
            if (err) {
                console.error(`[gtpp:item:file] Arquivo não encontrado em disco: ${absolutePath}`, err.message);
                res.status(404).json({ error: true, message: 'Arquivo não encontrado.' });
            }
        });
    }

    if (fileInfo.source === 'blob') {
        const blob = await useCases.getItemFileBlob(taskId, itemId);
        if (!blob) throw new AppError('Arquivo legado não encontrado.', 404);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="arquivo_${itemId}"`);
        return res.send(blob);
    }

    throw new AppError('Arquivo não encontrado.', 404);
}

/**
 * DELETE /gtpp/tasks/:taskId/items/:id
 * Soft-delete de um item (status = 0).
 * Evento WS tipo 2 — item removido.
 */
async function deleteTaskItem(req, res) {
    const taskId = parseInt(req.params.taskId, 10);
    const itemId = parseInt(req.params.id, 10);

    await useCases.deleteTaskItem(taskId, itemId, req.user.id);

    return respond.message(res, 'Item excluído com sucesso.');
}

module.exports = {
    getTaskItems,
    createTaskItem,
    updateTaskItem,
    deleteTaskItem,
    downloadItemFile,
};
