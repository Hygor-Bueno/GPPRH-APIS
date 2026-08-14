/**
 * @fileoverview Consultas SQL puras compartilhadas entre Task e Task Item —
 * o "guard" de estado/dono de uma tarefa.
 *
 * @module modules/global/repositories/mysql/gtpp-task-guard.queries
 */

const SQL_GET_TASK_USER_ID = `SELECT user_id FROM gt_task WHERE id = ?`;
const SQL_GET_TASK_STATE   = `SELECT state_id FROM gt_task WHERE id = ?`;

const SQL_AUTO_UPDATE_TASK_STATE = `UPDATE gt_task SET state_id = ? WHERE id = ?`;

/**
 * Insere um registro no histórico da tarefa.
 * Parâmetros: [description, state_id, task_id]
 */
const SQL_INSERT_TASK_HISTORIC = `
  INSERT INTO gt_task_historic (description, state_id, task_id, date_time)
  VALUES (?, ?, ?, NOW())
`;

/**
 * Itens elegíveis pra contagem de progresso: status ativo e que não sejam
 * perguntas sim/não ainda não respondidas (yes_no = -1 fica de fora da conta).
 */
const SQL_COUNT_ITEM_STATS = `
  SELECT
    COUNT(id) AS total,
    SUM(
      (\`yes_no\` = 0  AND \`check\` = 1) OR
      (\`yes_no\` IN (1, 2))
    ) AS checked
  FROM gt_task_item
  WHERE task_id = ? AND status = 1
    AND yes_no != -1
`;

module.exports = {
    SQL_GET_TASK_USER_ID,
    SQL_GET_TASK_STATE,
    SQL_AUTO_UPDATE_TASK_STATE,
    SQL_INSERT_TASK_HISTORIC,
    SQL_COUNT_ITEM_STATS,
};
