/**
 * @fileoverview Queries SQL puras — sub-feature Task Item (GTPP).
 *
 * `SQL_GET_TASK_ITEMS` é usada tanto por Task (detalhe da tarefa) quanto por
 * Task Item (listagem) — vive em `gtpp-task.queries.js` e é reaproveitada
 * daqui em vez de duplicada. As 4 constantes do motor de auto-transição
 * (`SQL_GET_TASK_STATE`, `SQL_COUNT_ITEM_STATS`, `SQL_AUTO_UPDATE_TASK_STATE`,
 * `SQL_INSERT_TASK_HISTORIC`) vivem em `gtpp-task-guard.queries.js` pelo
 * mesmo motivo.
 *
 * @module modules/global/repositories/mysql/gtpp-task-item.queries
 */

'use strict';

const SQL_GET_TASK_ITEM_BY_ID = `
  SELECT id, task_id, description, \`check\`, yes_no,
         \`order\`, status,
         CASE WHEN file_id IS NOT NULL OR file IS NOT NULL THEN 1 ELSE 0 END AS file,
         note, assigned_to, created_by
  FROM gt_task_item
  WHERE id = ? AND task_id = ?
`;

const SQL_GET_TASK_ITEM_MAX_ORDER = `
  SELECT COALESCE(MAX(\`order\`), 0) AS max_order
  FROM gt_task_item WHERE task_id = ? AND status = 1
`;

/** Datas de início e fim da tarefa pai (para validação de datas de itens). */
const SQL_GET_TASK_DATES = `
  SELECT initial_date, final_date FROM gt_task WHERE id = ?
`;

/**
 * Insere um item de tarefa.
 * Parâmetros: description, task_id, order, yes_no, created_by, initial_date, final_date
 * Nota: arquivos e notas são gravados por updates separados.
 */
const SQL_INSERT_TASK_ITEM = `
  INSERT INTO gt_task_item (description, task_id, \`order\`, yes_no, created_by, initial_date, final_date)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`;

const SQL_UPDATE_ITEM_CHECK       = `UPDATE gt_task_item SET \`check\` = ? WHERE id = ? AND task_id = ?`;
const SQL_UPDATE_ITEM_YES_NO      = `UPDATE gt_task_item SET yes_no = ? WHERE id = ? AND task_id = ?`;
const SQL_UPDATE_ITEM_ASSIGNED_TO = `UPDATE gt_task_item SET assigned_to = ? WHERE id = ? AND task_id = ?`;
const SQL_UPDATE_ITEM_DESCRIPTION = `UPDATE gt_task_item SET description = ? WHERE id = ? AND task_id = ?`;
const SQL_UPDATE_ITEM_DATES       = `UPDATE gt_task_item SET initial_date = ?, final_date = ? WHERE id = ? AND task_id = ?`;

/** Atualiza o arquivo de um item. Armazena file_id (FK) e file_name (snapshot imutável). */
const SQL_UPDATE_ITEM_FILE = `UPDATE gt_task_item SET file_id = ?, file_name = ? WHERE id = ? AND task_id = ?`;

/** Limpa o arquivo de um item (remove o vínculo com _files e o nome snapshot). */
const SQL_CLEAR_ITEM_FILE = `UPDATE gt_task_item SET file_id = NULL, file_name = NULL WHERE id = ? AND task_id = ?`;

/**
 * Recupera referências de arquivo de um item.
 * file_id → novo sistema (_files FK); file → legado (BLOB, somente leitura histórica)
 */
const SQL_GET_ITEM_FILE = `SELECT file_id, file FROM gt_task_item WHERE id = ?`;

/** Metadados do arquivo no novo sistema (_files), dado o file_id do item. */
const SQL_GET_FILE_METADATA = `
  SELECT file_path, file_name, file_extension, file_type, file_size FROM _files WHERE id = ?
`;

/** Conteúdo BLOB legado de um item (somente leitura histórica). */
const SQL_GET_ITEM_FILE_BLOB = `SELECT file FROM gt_task_item WHERE id = ? AND task_id = ?`;

const SQL_UPDATE_ITEM_NOTE   = `UPDATE gt_task_item SET note = ? WHERE id = ? AND task_id = ?`;
const SQL_UPDATE_ITEM_STATUS = `UPDATE gt_task_item SET status = ? WHERE id = ? AND task_id = ?`;
const SQL_SOFT_DELETE_ITEM   = `UPDATE gt_task_item SET status = 0 WHERE id = ? AND task_id = ?`;
const SQL_UPDATE_ITEM_ORDER  = `UPDATE gt_task_item SET \`order\` = ? WHERE id = ?`;

/** Item anterior para troca de posição (subir). */
const SQL_GET_ITEM_PREV = `
  SELECT id, \`order\` FROM gt_task_item
  WHERE task_id = ? AND status = 1 AND \`order\` < ?
  ORDER BY \`order\` DESC LIMIT 1
`;

/** Item seguinte para troca de posição (descer). */
const SQL_GET_ITEM_NEXT = `
  SELECT id, \`order\` FROM gt_task_item
  WHERE task_id = ? AND status = 1 AND \`order\` > ?
  ORDER BY \`order\` ASC LIMIT 1
`;

module.exports = {
    SQL_GET_TASK_ITEM_BY_ID,
    SQL_GET_TASK_ITEM_MAX_ORDER,
    SQL_GET_TASK_DATES,
    SQL_INSERT_TASK_ITEM,
    SQL_UPDATE_ITEM_CHECK,
    SQL_UPDATE_ITEM_YES_NO,
    SQL_UPDATE_ITEM_ASSIGNED_TO,
    SQL_UPDATE_ITEM_DESCRIPTION,
    SQL_UPDATE_ITEM_DATES,
    SQL_UPDATE_ITEM_FILE,
    SQL_CLEAR_ITEM_FILE,
    SQL_GET_ITEM_FILE,
    SQL_GET_FILE_METADATA,
    SQL_GET_ITEM_FILE_BLOB,
    SQL_UPDATE_ITEM_NOTE,
    SQL_UPDATE_ITEM_STATUS,
    SQL_SOFT_DELETE_ITEM,
    SQL_UPDATE_ITEM_ORDER,
    SQL_GET_ITEM_PREV,
    SQL_GET_ITEM_NEXT,
};
