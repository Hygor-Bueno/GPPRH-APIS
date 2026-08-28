/**
 * @fileoverview Queries SQL puras — sub-feature Message (chat de tarefa GTPP).
 * @module modules/global/repositories/mysql/gtpp-message.queries
 */

'use strict';

/** Lista todas as mensagens de uma tarefa em ordem cronológica. */
const SQL_GET_TASK_MESSAGES = `
  SELECT m.id, m.description, m.date_time, m.user_id, e.name,
    m.file_id, m.file_name
  FROM gt_message m
  INNER JOIN _user u ON u.id = m.user_id
  INNER JOIN _employee e ON e.id = m.user_id
  WHERE m.task_id = ?
  ORDER BY m.id ASC
`;

const SQL_GET_MESSAGE_BY_ID = `
  SELECT m.id, m.description, m.date_time, m.user_id, e.name,
    m.file_id, m.file_name
  FROM gt_message m
  INNER JOIN _user u ON u.id = m.user_id
  INNER JOIN _employee e ON e.id = m.user_id
  WHERE m.id = ?
`;

const SQL_INSERT_MESSAGE  = `INSERT INTO gt_message (description, date_time, task_id, user_id) VALUES (?, NOW(), ?, ?)`;
const SQL_UPDATE_MSG_FILE = `UPDATE gt_message SET file_id = ?, file_name = ? WHERE id = ?`;
const SQL_DELETE_MESSAGE  = `DELETE FROM gt_message WHERE id = ? AND task_id = ?`;

module.exports = {
    SQL_GET_TASK_MESSAGES,
    SQL_GET_MESSAGE_BY_ID,
    SQL_INSERT_MESSAGE,
    SQL_UPDATE_MSG_FILE,
    SQL_DELETE_MESSAGE,
};
