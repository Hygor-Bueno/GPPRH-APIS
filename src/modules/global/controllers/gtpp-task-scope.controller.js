/**
 * @fileoverview Controller de escopo de tarefas GTPP.
 * @module modules/global/controllers/gtpp-task-scope.controller
 */

'use strict';

const { AppError }        = require('../../../errors/app.error');
const { respond }         = require('../../../utils/respond');
const scopeService        = require('../services/gtpp-task-scope.service');
const taskService         = require('../services/gtpp-task.service');
const protheusService     = require('../../protheus/services/protheus.service');

/**
 * GET /gtpp/tasks/:taskId/scope
 * Lista os escopos vinculados à tarefa.
 */
async function getTaskScope(req, res) {
    const taskId = parseInt(req.params.taskId, 10);
    const scope  = await scopeService.getTaskScope(taskId);

    if (scope.length === 0) return respond.ok(res, []);

    // Busca descrições do Protheus em paralelo por company_code único
    const companyCodes = [...new Set(scope.map(s => s.company_code).filter(Boolean))];

    const [companies, ...branchesAndCCs] = await Promise.all([
        protheusService.getCompanies().catch(() => []),
        ...companyCodes.map(code =>
            Promise.all([
                protheusService.getBranches(code).catch(() => []),
                protheusService.getCostCenters(code).catch(() => []),
            ])
        ),
    ]);

    // Monta mapas de código → descrição
    const companyMap     = Object.fromEntries(companies.map(c => [c.company_code, c.company_name]));
    const branchMap      = {};
    const costCenterMap  = {};

    branchesAndCCs.forEach(([branches, ccs]) => {
        branches.forEach(b => { branchMap[b.branch_code]           = b.branch_name; });
        ccs.forEach(cc     => { costCenterMap[cc.costCenterCode]   = cc.costCenterDescription; });
    });

    const enriched = scope.map(s => ({
        ...s,
        company_name:      s.company_code      ? (companyMap[s.company_code]         ?? null) : null,
        branch_name:       s.branch_code       ? (branchMap[s.branch_code]            ?? null) : null,
        cost_center_name:  s.cost_center_code  ? (costCenterMap[s.cost_center_code]   ?? null) : null,
    }));

    return respond.ok(res, enriched);
}

/**
 * POST /gtpp/tasks/:taskId/scope
 * Adiciona um escopo à tarefa.
 * Body: { company_code?, branch_code?, cost_center_code? }
 * Todos os campos são opcionais — NULL = "todos" naquele nível.
 */
async function addTaskScope(req, res) {
    const taskId = parseInt(req.params.taskId, 10);

    await taskService.verifyTaskEditable(taskId);

    const { company_code, branch_code, cost_center_code } = req.body;

    const result = await scopeService.addTaskScope(taskId, {
        company_code:      company_code      ?? null,
        branch_code:       branch_code       ?? null,
        cost_center_code:  cost_center_code  ?? null,
    });

    return respond.created(res, result);
}

/**
 * DELETE /gtpp/tasks/:taskId/scope/:id
 * Remove um escopo da tarefa.
 */
async function removeTaskScope(req, res) {
    const taskId  = parseInt(req.params.taskId, 10);
    const scopeId = parseInt(req.params.id, 10);

    await taskService.verifyTaskEditable(taskId);
    await scopeService.removeTaskScope(taskId, scopeId);

    return respond.message(res, 'Escopo removido com sucesso.');
}

module.exports = { getTaskScope, addTaskScope, removeTaskScope };
