/**
 * @fileoverview Controller de escopo de tarefas GTPP.
 * @module modules/global/controllers/gtpp-task-scope.controller
 */

'use strict';

const { respond }         = require('../../../utils/respond');
const { ProtheusUseCases } = require('../../protheus/application/protheus.use-cases');
const { SqlServerProtheusRepository } = require('../../protheus/infrastructure/sqlserver-protheus.repository');
const { GtppTaskScopeUseCases } = require('../application/gtpp/task-scope/gtpp-task-scope.use-cases');
const { MysqlTaskScopeRepository } = require('../infrastructure/gtpp/mysql-task-scope.repository');
const { MysqlGtppTaskGuardRepository } = require('../infrastructure/gtpp/mysql-gtpp-task-guard.repository');
const { ProtheusGtppScopeNameResolver } = require('../infrastructure/gtpp/protheus-gtpp-scope-name.resolver');

const useCases = new GtppTaskScopeUseCases({
    repository: new MysqlTaskScopeRepository(),
    taskGuardRepository: new MysqlGtppTaskGuardRepository(),
});
const scopeNameResolver = new ProtheusGtppScopeNameResolver({
    protheusUseCases: new ProtheusUseCases({ repository: new SqlServerProtheusRepository() }),
});

/**
 * GET /gtpp/tasks/:taskId/scope
 * Lista os escopos vinculados à tarefa, com as descrições do Protheus.
 */
async function getTaskScope(req, res) {
    const taskId = parseInt(req.params.taskId, 10);
    const scope  = await useCases.getTaskScope(taskId);

    return respond.ok(res, await scopeNameResolver.resolve(scope));
}

/**
 * POST /gtpp/tasks/:taskId/scope
 * Adiciona um escopo à tarefa.
 * Body: { company_code?, branch_code?, cost_center_code? }
 * Todos os campos são opcionais — NULL = "todos" naquele nível.
 */
async function addTaskScope(req, res) {
    const taskId = parseInt(req.params.taskId, 10);
    const { company_code, branch_code, cost_center_code } = req.body;

    const result = await useCases.addTaskScope(taskId, { company_code, branch_code, cost_center_code });

    return respond.created(res, result);
}

/**
 * DELETE /gtpp/tasks/:taskId/scope/:id
 * Remove um escopo da tarefa.
 */
async function removeTaskScope(req, res) {
    const taskId  = parseInt(req.params.taskId, 10);
    const scopeId = parseInt(req.params.id, 10);

    await useCases.removeTaskScope(taskId, scopeId);

    return respond.message(res, 'Escopo removido com sucesso.');
}

module.exports = { getTaskScope, addTaskScope, removeTaskScope };
