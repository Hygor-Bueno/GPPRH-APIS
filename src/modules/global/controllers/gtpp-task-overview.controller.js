/**
 * @fileoverview Controller da visão de supervisão (diretoria) do GTPP.
 * @module modules/global/controllers/gtpp-task-overview.controller
 */

'use strict';

const { respond } = require('../../../utils/respond');
const { GtppTaskOverviewUseCases } = require('../application/gtpp/task-overview/gtpp-task-overview.use-cases');
const { MysqlTaskOverviewRepository } = require('../infrastructure/gtpp/mysql-task-overview.repository');
const { SqlServerCostCenterMemberRepository } = require('../infrastructure/gtpp/sqlserver-cost-center-member.repository');

const useCases = new GtppTaskOverviewUseCases({
    repository: new MysqlTaskOverviewRepository(),
    costCenterMemberRepository: new SqlServerCostCenterMemberRepository(),
});

/**
 * GET /gtpp/overview/tasks
 * Lista qualquer tarefa do GTPP, sem a trava de criador/vinculado.
 *
 * Query params (todos opcionais):
 *  - employee_registration + employee_branch : colaborador escolhido na busca
 *                       do Protheus (matrícula + filial, sempre juntos) —
 *                       tarefas que ele criou ou em que está vinculado
 *  - user_id          : number — alternativa ao par acima, pelo id do sistema
 *  - user_role        : any | creator | member (padrão any)
 *  - company_code     : string — empresa do criador ('02')
 *  - branch_code      : string — unidade/filial do criador ('0201'; já implica a empresa)
 *  - cost_center_code : string — centro de custo do criador no Protheus
 *                                (exige company_code ou branch_code)
 *
 *  Empresa/unidade/CC são a lotação ATUAL de quem criou a tarefa. Tarefas de
 *  usuários sem matrícula/filial nunca aparecem nesses três filtros.
 *  - state_ids        : csv    — ex.: 1,2,3 (máx. 10)
 *  - priority         : number
 *  - search           : string — trecho do título
 *  - due_from, due_to : AAAA-MM-DD — intervalo do prazo final
 *  - overdue          : true   — prazo vencido e tarefa não encerrada
 *  - page, limit      : paginação (limit padrão 50, máx. 100)
 *
 * Resposta: { data: Task[], page, limit, hasMore }
 */
async function listTasks(req, res) {
    const result = await useCases.listTasks(req.query);
    return respond.ok(res, result);
}

/**
 * GET /gtpp/overview/tasks/summary
 * Total de tarefas por estado, com os mesmos filtros da listagem.
 *
 * Resposta: { total, states: [{ state_id, state_description, state_color, total }] }
 */
async function summarizeTasks(req, res) {
    const result = await useCases.summarizeTasks(req.query);
    return respond.ok(res, result);
}

module.exports = { listTasks, summarizeTasks };
