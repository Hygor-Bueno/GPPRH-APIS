/**
 * @fileoverview Consultas SQL puras para pontuação GTPP (gt_task, gt_task_item).
 *
 * @module modules/global/repositories/mysql/gtpp-score.queries
 */

/**
 * Pontuação de um usuário.
 * Requer 15 parâmetros, todos userId (na mesma ordem do PHP original).
 */
const SQL_GET_SCORE = `
  SELECT
    (
      (SELECT COUNT(i.id)*0.04 FROM gt_task_item i INNER JOIN gt_task t ON t.id = i.task_id
        WHERE t.user_id = ? AND t.state_id = 6 AND t.disqualify = 0)
      + (SELECT COUNT(i.id)*0.03 FROM gt_task_item i INNER JOIN gt_task_user tu ON tu.task_id = i.task_id INNER JOIN gt_task t ON t.id = i.task_id
        WHERE tu.user_id = ? AND t.state_id = 6 AND t.disqualify = 0)
      + (SELECT COUNT(i.id)*0.02 FROM gt_task_item i INNER JOIN gt_task t ON t.id = i.task_id
        WHERE t.user_id = ? AND i.\`check\` = 1 AND t.state_id = 2 AND t.disqualify = 0)
      + (SELECT COUNT(i.id)*0.02 FROM gt_task_item i INNER JOIN gt_task_user tu ON tu.task_id = i.task_id INNER JOIN gt_task t ON t.id = i.task_id
        WHERE tu.user_id = ? AND i.\`check\` = 1 AND t.state_id = 2 AND t.disqualify = 0)
      + (SELECT COUNT(i.id)*0.02 FROM gt_task_item i INNER JOIN gt_task t ON t.id = i.task_id
        WHERE t.user_id = ? AND t.state_id = 3 AND t.disqualify = 0)
      + (SELECT COUNT(i.id)*0.03 FROM gt_task_item i INNER JOIN gt_task_user tu ON tu.task_id = i.task_id INNER JOIN gt_task t ON t.id = i.task_id
        WHERE tu.user_id = ? AND t.state_id = 3 AND t.disqualify = 0)
      + (SELECT COUNT(i.id)*-0.02 FROM gt_task_item i INNER JOIN gt_task t ON t.id = i.task_id
        WHERE t.user_id = ? AND t.state_id = 4 AND t.disqualify = 0)
      + (SELECT COUNT(i.id)*-0.04 FROM gt_task_item i INNER JOIN gt_task t ON t.id = i.task_id
        WHERE t.user_id = ? AND t.state_id = 5 AND t.disqualify = 0)
    ) AS score,
    (SELECT COUNT(id) FROM gt_task WHERE user_id = ?) AS user_task_count,
    (SELECT COUNT(task_id) FROM gt_task_user WHERE user_id = ?) AS attached_task_count,
    (
      (SELECT COUNT(id) FROM gt_task WHERE user_id = ? AND state_id IN (1,2,3,5))
      + (SELECT COUNT(tu.task_id) FROM gt_task_user tu INNER JOIN gt_task t ON t.id = tu.task_id
         WHERE tu.user_id = ? AND t.state_id IN (1,2,3,5))
    ) AS current_task_count,
    (
      (SELECT COUNT(id) FROM gt_task WHERE user_id = ? AND state_id = 6)
      + (SELECT COUNT(tu.task_id) FROM gt_task_user tu INNER JOIN gt_task t ON t.id = tu.task_id
         WHERE tu.user_id = ? AND t.state_id = 6)
    ) AS finished_task_count,
    (SELECT COUNT(id) FROM gt_task WHERE user_id = ? AND disqualify = 1) AS disqualify_task_count
`;

const SQL_GET_DISQUALIFY    = `SELECT disqualify FROM gt_task WHERE id = ?`;
const SQL_UPDATE_DISQUALIFY = `UPDATE gt_task SET disqualify = ? WHERE id = ?`;

/** Todos os usuários com acesso GTPP (application_id 2 ou 3). */
const SQL_GET_ALL_USERS_WITH_ACCESS = `
  SELECT DISTINCT u.id, e.name AS \`user\`
  FROM _user u
  INNER JOIN _employee e ON e.id = u.id
  INNER JOIN _application_access aa ON aa.user_id = u.id
  WHERE u.status = 1 AND aa.application_id IN (2, 3)
  ORDER BY e.name ASC
`;

module.exports = {
    SQL_GET_SCORE,
    SQL_GET_DISQUALIFY,
    SQL_UPDATE_DISQUALIFY,
    SQL_GET_ALL_USERS_WITH_ACCESS,
};
