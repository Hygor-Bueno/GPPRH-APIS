/**
 * @fileoverview Consultas SQL puras para usuários vinculados a tarefas GTPP
 * (gt_task_user).
 *
 * @module modules/global/repositories/mysql/gtpp-task-user.queries
 */

/**
 * Todos os participantes de uma tarefa (criador + vinculados).
 * Migrada de `src/websocket/events/gtpp.event.js` (era `SQL_GET_TASK_USERS_ALL`,
 * texto idêntico) — antes duplicada ali, agora com um dono só.
 * Parâmetros: [taskId, taskId]
 */
const SQL_GET_TASK_PARTICIPANT_IDS = `
  SELECT user_id FROM gt_task_user WHERE task_id = ?
  UNION
  SELECT user_id FROM gt_task WHERE id = ?
`;

/**
 * Todos os usuários com acesso GTPP, indicando (`check`) se já estão
 * vinculados à tarefa. O criador da tarefa nunca aparece na lista.
 * Parâmetros: [taskId, taskId, taskId]
 */
const SQL_GET_TASK_USERS = `
  SELECT u.user_id, e.name, true AS \`check\`
  FROM gt_task t
  INNER JOIN gt_task_user u ON u.task_id = t.id
  INNER JOIN _user _u ON u.user_id = _u.id
  INNER JOIN _employee e ON e.id = u.user_id
  WHERE t.id = ? AND u.user_id != t.user_id AND _u.status = 1
  UNION
  SELECT _u.id AS user_id, _u.name, false AS \`check\`
  FROM _user _u
  INNER JOIN _application_access _aa ON _u.id = _aa.user_id
  WHERE
    _u.id NOT IN (SELECT user_id FROM gt_task_user WHERE task_id = ?)
    AND _u.id != (SELECT user_id FROM gt_task WHERE id = ?)
    AND _u.status = 1
    AND (_aa.application_id = 3 OR _aa.application_id = 2)
`;

/** Verifica se um usuário já está vinculado à tarefa (como colaborador ou criador). Parâmetros: [taskId, userId, taskId, userId] */
const SQL_CHECK_USER_IN_TASK = `
  SELECT (
    (SELECT COUNT(task_id) FROM gt_task_user WHERE task_id = ? AND user_id = ?) +
    (SELECT COUNT(id) FROM gt_task WHERE id = ? AND user_id = ?)
  ) AS count
`;

const SQL_INSERT_TASK_USER = `INSERT INTO gt_task_user (task_id, user_id) VALUES (?, ?)`;
const SQL_DELETE_TASK_USER = `DELETE FROM gt_task_user WHERE task_id = ? AND user_id = ?`;

module.exports = {
    SQL_GET_TASK_PARTICIPANT_IDS,
    SQL_GET_TASK_USERS,
    SQL_CHECK_USER_IN_TASK,
    SQL_INSERT_TASK_USER,
    SQL_DELETE_TASK_USER,
};
