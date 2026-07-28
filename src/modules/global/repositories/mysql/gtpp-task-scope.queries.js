/**
 * @fileoverview Queries SQL puras — sub-feature Task Scope (GTPP).
 * @module modules/global/repositories/mysql/gtpp-task-scope.queries
 */

'use strict';

/** Lista os escopos de uma tarefa em ordem de inserção. */
const SQL_GET_TASK_SCOPE = `
  SELECT id, task_id, company_code, branch_code, cost_center_code
  FROM gt_task_scope
  WHERE task_id = ?
  ORDER BY id ASC
`;

/**
 * Adiciona um escopo à tarefa. Níveis NULL significam "todos" naquele nível.
 * Parâmetros: [task_id, company_code, branch_code, cost_center_code]
 */
const SQL_INSERT_TASK_SCOPE = `
  INSERT INTO gt_task_scope (task_id, company_code, branch_code, cost_center_code)
  VALUES (?, ?, ?, ?)
`;

/** Remove um escopo da tarefa. Parâmetros: [id, task_id] */
const SQL_DELETE_TASK_SCOPE = `
  DELETE FROM gt_task_scope WHERE id = ? AND task_id = ?
`;

module.exports = { SQL_GET_TASK_SCOPE, SQL_INSERT_TASK_SCOPE, SQL_DELETE_TASK_SCOPE };
