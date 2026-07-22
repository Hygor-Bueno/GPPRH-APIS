/**
 * @fileoverview Controller de itens de tarefa GTPP.
 * @module modules/global/controllers/gtpp-task-item.controller
 */

'use strict';

const { AppError }           = require('../../../errors/app.error');
const { respond }            = require('../../../utils/respond');
const { FileService }        = require('../../../utils/file/file.service');
const { broadcastGtppEvent } = require('../../../websocket/events/gtpp.event');
const itemService            = require('../services/gtpp-task-item.service');
const taskService            = require('../services/gtpp-task.service');

/**
 * Verifica se o usuário autenticado é dono do item, dono da tarefa ou admin.
 * Usado para operações restritas ao item (ex: alterar prazos).
 */
function assertItemOrTaskOwnerOrAdmin(req, itemCreatedBy, taskCreatorId) {
    const perms   = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
    const isAdmin = perms.includes('MANAGE_GTPP') || perms.includes('SYSTEM_OWNER');
    if (req.user.id !== itemCreatedBy && req.user.id !== taskCreatorId && !isAdmin) {
        throw new AppError('Apenas o dono do item, o criador da tarefa ou um administrador pode alterar os prazos.', 403);
    }
}

// Tipo 2 = item alterado (check, criação, remoção, etc.)
const EV_ITEM = 2;

/**
 * GET /gtpp/tasks/:taskId/items
 * Lista todos os itens ativos de uma tarefa.
 */
async function getTaskItems(req, res) {
    const taskId = parseInt(req.params.taskId, 10);
    const items = await itemService.getTaskItems(taskId);
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
    await taskService.verifyTaskEditable(taskId);

    const { description, note, yes_no, initial_date, final_date } = req.body;
    if (req.file) {
        req.file.originalname = req.body.file_name
            ?? Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    }

    const result = await itemService.createTaskItem(taskId, req.user.id, {
        description,
        file:        req.file ?? null,
        note,
        yesNo:       yes_no,
        initialDate: initial_date ?? null,
        finalDate:   final_date   ?? null,
    });

    broadcastGtppEvent(taskId, req.user.id, EV_ITEM, {
        action: 'created',
        id:     result.itemId,
    }).catch(() => {});

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

    // Campos extras a incluir no evento WS conforme a action
    let eventExtra = {};

    switch (action) {

        case 'check': {
            await taskService.verifyTaskEditable(taskId);
            const checkVal = req.body.check ? 1 : 0;
            await itemService.updateItemCheck(taskId, itemId, checkVal, req.user.id);
            eventExtra = { check: checkVal };
            break;
        }

        case 'yes_no': {
            await taskService.verifyTaskEditable(taskId);
            const yesNoVal = Number(req.body.yes_no);
            await itemService.updateItemYesNo(taskId, itemId, yesNoVal, req.user.id);
            eventExtra = { yes_no: yesNoVal };
            break;
        }

        case 'description':
            await taskService.verifyTaskEditable(taskId);
            await itemService.updateItemDescription(taskId, itemId, req.body.description);
            eventExtra = { description: req.body.description };
            break;

        case 'file':
            await taskService.verifyTaskEditable(taskId);
            await itemService.updateItemFile(taskId, itemId, req.user.id, req.file ?? null);
            break;

        case 'note':
            await taskService.verifyTaskEditable(taskId);
            await itemService.updateItemNote(taskId, itemId, req.body.note ?? null);
            eventExtra = { note: req.body.note ?? null };
            break;

        case 'assigned_to': {
            await taskService.verifyTaskEditable(taskId);
            const assignedTo = req.body.assigned_to ? parseInt(req.body.assigned_to, 10) : null;
            await itemService.updateItemAssignedTo(taskId, itemId, assignedTo);
            eventExtra = { assigned_to: assignedTo };
            break;
        }

        case 'status': {
            await taskService.verifyTaskEditable(taskId);
            const statusVal = Number(req.body.status);
            await itemService.updateItemStatus(taskId, itemId, statusVal);
            eventExtra = { status: statusVal };
            break;
        }

        case 'position': {
            await taskService.verifyTaskEditable(taskId);
            const dir = req.body.direction;
            if (!['up', 'down'].includes(dir)) {
                throw new AppError('Direção inválida. Use "up" ou "down".', 400);
            }
            await itemService.updateItemPosition(taskId, itemId, dir);
            eventExtra = { direction: dir };
            break;
        }

        case 'dates': {
            await taskService.verifyTaskEditable(taskId);
            const item          = await itemService.getItemById(taskId, itemId);
            const taskCreatorId = await taskService.getTaskCreatorId(taskId);
            assertItemOrTaskOwnerOrAdmin(req, item.created_by, taskCreatorId);
            const initialDate = req.body.initial_date ?? null;
            const finalDate   = req.body.final_date   ?? null;
            await itemService.updateItemDates(taskId, itemId, initialDate, finalDate);
            eventExtra = { initial_date: initialDate, final_date: finalDate };
            break;
        }

        default:
            throw new AppError(`Ação desconhecida: "${action}".`, 400);
    }

    broadcastGtppEvent(taskId, req.user.id, EV_ITEM, {
        action: action === 'position' ? 'updated' : action,
        id:     itemId,
        ...eventExtra,
    }).catch(() => {});

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

    const fileInfo = await itemService.getItemFileInfo(itemId);

    if (!fileInfo) {
        throw new AppError('Este item não possui arquivo anexado.', 404);
    }

    if (fileInfo.source === 'files') {
        const record = await FileService.findById(
            await itemService.getItemFileId(taskId, itemId)
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
        const blob = await itemService.getItemFileBlob(taskId, itemId);
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

    await taskService.verifyTaskEditable(taskId);
    await itemService.deleteTaskItem(taskId, itemId, req.user.id);

    broadcastGtppEvent(taskId, req.user.id, EV_ITEM, {
        action: 'deleted',
        id:     itemId,
    }).catch(() => {});

    return respond.message(res, 'Item excluído com sucesso.');
}

module.exports = {
    getTaskItems,
    createTaskItem,
    updateTaskItem,
    deleteTaskItem,
    downloadItemFile,
};
