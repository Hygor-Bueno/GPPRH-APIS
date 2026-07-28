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

const useCases = new GtppTaskScopeUseCases({
    repository: new MysqlTaskScopeRepository(),
    taskGuardRepository: new MysqlGtppTaskGuardRepository(),
});
const protheusUseCases = new ProtheusUseCases({ repository: new SqlServerProtheusRepository() });

/**
 * GET /gtpp/tasks/:taskId/scope
 * Lista os escopos vinculados à tarefa.
 */
async function getTaskScope(req, res) {
    const taskId = parseInt(req.params.taskId, 10);
    const scope  = await useCases.getTaskScope(taskId);

    if (scope.length === 0) return respond.ok(res, []);

    // Busca descrições do Protheus em paralelo por company_code único
    const companyCodes = [...new Set(scope.map(s => s.company_code).filter(Boolean))];

    const [companies, ...branchesAndCCs] = await Promise.all([
        protheusUseCases.getCompanies().catch(() => []),
        ...companyCodes.map(code =>
            Promise.all([
                protheusUseCases.getBranches(code).catch(() => []),
                protheusUseCases.getCostCenters(code).catch(() => []),
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
