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
 * Todos os usuários ativos, indicando (`check`) se já estão vinculados à
 * tarefa. Os vinculados vêm primeiro, depois em ordem alfabética.
 *
 * `file_id` é a foto do colaborador (FK para `_files`), no mesmo formato que
 * `GET /users` devolve — permite ao front exibir o avatar na lista de
 * vinculação sem uma segunda requisição. É NULL para quem nunca subiu foto.
 *
 * Elegibilidade é `ad_status = 'active'`; o criador da tarefa aparece na
 * lista como qualquer outro usuário.
 *
 * Parâmetros: [taskId, taskId]
 */
const SQL_GET_TASK_USERS = `
  SELECT
      u.id                                   AS user_id,
      ?                                      AS task_id,
      u.name                                 AS name,
      IF(tu.user_id IS NULL, 0, 1)           AS status,
      IF(tu.user_id IS NULL, 0, 1)           AS \`check\`,
      u.file_id                              AS file_id
  FROM _user u
  LEFT JOIN gt_task_user tu
         ON tu.user_id = u.id
        AND tu.task_id = ?
  WHERE u.ad_status = 'active'
  ORDER BY status DESC, u.name
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
