/**
 * @fileoverview Controller de usuários vinculados a tarefas GTPP.
 * @module modules/global/controllers/gtpp-task-user.controller
 */

'use strict';

const { AppError } = require('../../../errors/app.error');
const { respond } = require('../../../utils/respond');
const { GtppTaskUserUseCases } = require('../application/gtpp/task-user/gtpp-task-user.use-cases');
const { MysqlTaskUserRepository } = require('../infrastructure/gtpp/mysql-task-user.repository');
const { MysqlGtppTaskGuardRepository } = require('../infrastructure/gtpp/mysql-gtpp-task-guard.repository');
const { HttpGtppEventPublisher } = require('../infrastructure/gtpp/http-gtpp-event.publisher');

const useCases = new GtppTaskUserUseCases({
    repository: new MysqlTaskUserRepository(),
    taskGuardRepository: new MysqlGtppTaskGuardRepository(),
    eventPublisher: new HttpGtppEventPublisher(),
});

/**
 * GET /gtpp/tasks/:taskId/users
 * Lista usuários com acesso GTPP, indicando quais estão vinculados à tarefa.
 */
async function getTaskUsers(req, res) {
    const taskId = parseInt(req.params.taskId, 10);
    const users = await useCases.getTaskUsers(taskId);
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

    const result = await useCases.toggleTaskUser(taskId, parseInt(user_id, 10), req.user);

    return respond.ok(res, result);
}

module.exports = {
    getTaskUsers,
    toggleTaskUser,
};
