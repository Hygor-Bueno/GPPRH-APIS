/**
 * @fileoverview Queries SQL puras — sub-feature Task Overview (GTPP).
 *
 * Visão de supervisão (diretoria): lista QUALQUER tarefa, sem a trava de
 * "criador ou vinculado" de `gtpp-task.queries.js`. Por isso não há join com o
 * tema por usuário (`gt_task_user.theme_id_fk`) — o tema é pessoal de cada
 * participante e não faz sentido pra quem só observa.
 *
 * @module modules/global/repositories/mysql/gtpp-task-overview.queries
 */

'use strict';

/** Escapa os curingas do LIKE para que a busca seja literal. */
function escapeLike(text) {
    return text.replace(/[\\%_]/g, ch => `\\${ch}`);
}

/**
 * Monta o WHERE comum à listagem e ao resumo a partir dos filtros normalizados
 * por `normalizeOverviewFilters`.
 *
 * Empresa/unidade/centro de custo são a lotação ATUAL do criador da tarefa.
 * Criador sem matrícula/filial (usuários legados, `branch_code` NULL) nunca
 * casa com esses filtros.
 *
 * @param {object} filters
 * @param {Array<{registration:string, branchCode:string}>} [filters.creatorPairs]
 *   colaboradores do centro de custo, resolvidos no Protheus pelo use-case
 * @param {number[]} closedStates - estados que não contam como atrasada
 * @returns {{ where: string, params: Array }}
 */
function buildOverviewWhere(filters, closedStates) {
    const clauses = [];
    const params = [];

    // `userIds` vem do use-case: o `user_id` informado, ou os usuários
    // resolvidos a partir da matrícula + filial do colaborador.
    if (filters.userIds?.length) {
        const ids = filters.userIds.map(() => '?').join(', ');
        const isCreator = `t.user_id IN (${ids})`;
        const isMember = `EXISTS (SELECT 1 FROM gt_task_user fu WHERE fu.task_id = t.id AND fu.user_id IN (${ids}))`;
        if (filters.userRole === 'creator') {
            clauses.push(isCreator);
            params.push(...filters.userIds);
        } else if (filters.userRole === 'member') {
            clauses.push(isMember);
            params.push(...filters.userIds);
        } else {
            clauses.push(`(${isCreator} OR ${isMember})`);
            params.push(...filters.userIds, ...filters.userIds);
        }
    }

    // Lotação do criador: `_user.branch_code` é a filial do Protheus, cujo
    // prefixo é a empresa. A unidade, quando informada, já implica a empresa.
    if (filters.branchCode) {
        clauses.push('u.branch_code = ?');
        params.push(filters.branchCode);
    } else if (filters.companyCode) {
        clauses.push('u.branch_code LIKE ?');
        params.push(`${filters.companyCode}%`);
    }

    // Centro de custo só existe no Protheus: o use-case resolve antes quais
    // colaboradores (matrícula + filial) pertencem a ele.
    if (filters.creatorPairs) {
        const tuples = filters.creatorPairs.map(() => '(?, ?)').join(', ');
        clauses.push(`(TRIM(u.registration), u.branch_code) IN (${tuples})`);
        for (const { registration, branchCode } of filters.creatorPairs) params.push(registration, branchCode);
    }

    if (filters.stateIds?.length) {
        clauses.push(`t.state_id IN (${filters.stateIds.map(() => '?').join(', ')})`);
        params.push(...filters.stateIds);
    }

    if (filters.priority != null) {
        clauses.push('t.priority = ?');
        params.push(filters.priority);
    }

    if (filters.search) {
        // Barra invertida já é o escape padrão do LIKE no MySQL.
        clauses.push('t.description LIKE ?');
        params.push(`%${escapeLike(filters.search)}%`);
    }

    if (filters.dueFrom) {
        clauses.push('t.final_date >= ?');
        params.push(filters.dueFrom);
    }
    if (filters.dueTo) {
        clauses.push('t.final_date <= ?');
        params.push(filters.dueTo);
    }

    if (filters.overdue) {
        clauses.push(`t.final_date < CURDATE() AND t.state_id NOT IN (${closedStates.map(() => '?').join(', ')})`);
        params.push(...closedStates);
    }

    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/**
 * Listagem paginada. Busca `limit + 1` linhas para o adapter calcular
 * `hasMore` sem um COUNT extra. LIMIT/OFFSET inlinados pelo mesmo motivo de
 * `buildGetTasksQuery` (mysql2 + prepared statements); ambos são inteiros
 * já validados no domínio e passam de novo por parseInt aqui.
 */
function buildTaskOverviewQuery(filters, closedStates) {
    const safeLimit  = parseInt(filters.limit, 10) || 50;
    const safeOffset = ((parseInt(filters.page, 10) || 1) - 1) * safeLimit;
    const { where, params } = buildOverviewWhere(filters, closedStates);

    const sql = `
  SELECT
    t.id,
    t.description,
    t.user_id,
    UPPER(TRIM(u.name)) AS creator_name,
    u.branch_code AS creator_branch_code,
    ts.id AS state_id,
    ts.description AS state_description,
    ts.color AS state_color,
    t.priority,
    t.initial_date,
    t.final_date,
    DATEDIFF(t.final_date, CURDATE()) AS expire,
    ROUND(COALESCE(
      (SELECT COUNT(i.id) FROM gt_task_item i WHERE i.task_id = t.id AND i.\`check\` = 1 AND i.status = 1)
      / NULLIF((SELECT COUNT(i.id) FROM gt_task_item i WHERE i.task_id = t.id AND i.status = 1), 0)
      * 100, 0
    )) AS percent,
    (
      SELECT GROUP_CONCAT(tu2.user_id ORDER BY tu2.user_id)
      FROM gt_task_user tu2
      WHERE tu2.task_id = t.id
    ) AS colabs_raw
  FROM gt_task t
  INNER JOIN gt_task_state ts ON ts.id = t.state_id
  INNER JOIN _user u ON u.id = t.user_id
  ${where}
  ORDER BY t.id DESC
  LIMIT ${safeLimit + 1} OFFSET ${safeOffset}
    `;

    return { sql, params };
}

/**
 * Contagem por estado com os mesmos filtros da listagem (cards/colunas do
 * painel da diretoria). Ignora paginação.
 */
function buildTaskOverviewSummaryQuery(filters, closedStates) {
    const { where, params } = buildOverviewWhere(filters, closedStates);

    const sql = `
  SELECT ts.id AS state_id, ts.description AS state_description, ts.color AS state_color, COUNT(*) AS total
  FROM gt_task t
  INNER JOIN gt_task_state ts ON ts.id = t.state_id
  INNER JOIN _user u ON u.id = t.user_id
  ${where}
  GROUP BY ts.id, ts.description, ts.color
  ORDER BY ts.id ASC
    `;

    return { sql, params };
}

/**
 * Usuários do sistema ligados a um colaborador do Protheus (matrícula + filial).
 * Normalmente é um só; mais de um indica cadastro duplicado em `_user`, e todos
 * entram no filtro. Parâmetros: [registration, branch_code]
 */
const SQL_FIND_USER_IDS_BY_EMPLOYEE = `
  SELECT id FROM _user WHERE TRIM(registration) = ? AND branch_code = ?
`;

module.exports = {
    buildOverviewWhere,
    buildTaskOverviewQuery,
    buildTaskOverviewSummaryQuery,
    escapeLike,
    SQL_FIND_USER_IDS_BY_EMPLOYEE,
};
