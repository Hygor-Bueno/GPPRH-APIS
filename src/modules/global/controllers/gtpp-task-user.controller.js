/**
 * @fileoverview Controller de usuários vinculados a tarefas GTPP.
 * @module modules/global/controllers/gtpp-task-user.controller
 */

'use strict';

const { AppError }           = require('../../../errors/app.error');
const { respond }            = require('../../../utils/respond');
const { broadcastGtppEvent } = require('../../../websocket/events/gtpp.event');
const taskUserService        = require('../services/gtpp-task-user.service');
const taskService            = require('../services/gtpp-task.service');

// Tipo 5 = usuário vinculado/desvinculado
const EV_USER = 5;

/**
 * Verifica se o usuário autenticado é o criador ou tem permissão admin.
 */
function assertCreatorOrAdmin(req, taskCreatorId) {
    const perms   = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
    const isAdmin = perms.includes('MANAGE_GTPP') || perms.includes('SYSTEM_OWNER');
    if (req.user.id !== taskCreatorId && !isAdmin) {
        throw new AppError('Apenas o criador ou administrador pode gerenciar usuários da tarefa.', 403);
    }
}

/**
 * GET /gtpp/tasks/:taskId/users
 * Lista usuários com acesso GTPP, indicando quais estão vinculados à tarefa.
 */
async function getTaskUsers(req, res) {
    const taskId = parseInt(req.params.taskId, 10);
    const users = await taskUserService.getTaskUsers(taskId);
    return respond.ok(res, users);
}

/**
 * PUT /gtpp/tasks/:taskId/users
 * Alterna o vínculo de um usuário à tarefa (add ↔ remove).
 * Body: { user_id }
 * Evento WS tipo 5 — usuário vinculado/desvinculado.
 */
async function toggleTaskUser(req, res) {
    const taskId = parseInt(req.params.taskId, 10);
    const { user_id } = req.body;

    if (!user_id) throw new AppError('O campo user_id é obrigatório.', 400);

    const creatorId = await taskService.getTaskCreatorId(taskId);
    assertCreatorOrAdmin(req, creatorId);

    await taskService.verifyTaskEditable(taskId);

    const result = await taskUserService.toggleTaskUser(taskId, parseInt(user_id, 10));

    // Quando o usuário é removido ele já não está em gt_task_user,
    // por isso é passado explicitamente em includeUserIds para garantir
    // que ele receba o evento e possa remover a tarefa da sua tela.
    const affectedUserId = parseInt(user_id, 10);
    broadcastGtppEvent(
        taskId,
        req.user.id,
        EV_USER,
        { action: result.action, id: affectedUserId },
        result.action === 'removed' ? [affectedUserId] : []
    ).catch(() => {});

    return respond.ok(res, result);
}

module.exports = {
    getTaskUsers,
    toggleTaskUser,
};
