/**
 * @fileoverview Queries SQL puras — sub-feature Task Item Response (GTPP).
 * @module modules/global/repositories/mysql/gtpp-task-item-response.queries
 */

'use strict';

/** Respostas/evidências ativas de um item com arquivo e nome do autor. */
const SQL_GET_ITEM_RESPONSES = `
  SELECT
    r.id,
    r.task_item_id_fk,
    r.comment,
    r.file_id,
    r.file_name,
    f.file_path,
    f.file_extension,
    f.file_type,
    f.file_size,
    r.status,
    r.created_by_fk,
    r.created_at,
    e.name
  FROM gt_task_item_response r
  LEFT JOIN _files f ON f.id = r.file_id
  LEFT JOIN _employee e ON e.id = r.created_by_fk
  WHERE r.task_item_id_fk = ? AND r.status = 1
  ORDER BY r.created_at ASC
`;

/** Parâmetros: [task_item_id_fk, comment, created_by_fk, file_id, file_name] */
const SQL_INSERT_TASK_ITEM_RESPONSE = `
  INSERT INTO gt_task_item_response (task_item_id_fk, comment, status, created_by_fk, file_id, file_name)
  VALUES (?, ?, 1, ?, ?, ?)
`;

const SQL_SOFT_DELETE_RESPONSE = `UPDATE gt_task_item_response SET status = 0 WHERE id = ?`;
const SQL_UPDATE_RESPONSE      = `UPDATE gt_task_item_response SET comment = ? WHERE id = ? AND status = 1`;

/**
 * Resolve o task_id de uma resposta a partir do item pai — elimina a
 * violação de camada em que o controller consultava `gt_task_item`
 * diretamente via `poolGlobal` para poder emitir o evento WebSocket.
 */
const SQL_FIND_TASK_ID_BY_ITEM_ID = `SELECT task_id FROM gt_task_item WHERE id = ?`;

module.exports = {
    SQL_GET_ITEM_RESPONSES,
    SQL_INSERT_TASK_ITEM_RESPONSE,
    SQL_SOFT_DELETE_RESPONSE,
    SQL_UPDATE_RESPONSE,
    SQL_FIND_TASK_ID_BY_ITEM_ID,
};
