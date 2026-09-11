/**
 * @fileoverview Queries SQL puras — sub-feature Task Item Response (GTPP).
 *
 * Os anexos de um comentário deixaram de viver nas colunas
 * `gt_task_item_response.file_id` / `.file_name` (um único arquivo) e passaram
 * para `gt_task_item_response_files` (N arquivos por comentário, FK
 * `task_item_response_id_fk`). As colunas antigas ainda são gravadas — ver
 * `SQL_INSERT_TASK_ITEM_RESPONSE` — mas nenhuma leitura depende mais delas.
 *
 * @module modules/global/repositories/mysql/gtpp-task-item-response.queries
 */

'use strict';

/**
 * Comentários/evidências ativos de um item, com o nome do autor.
 *
 * Sem join em `_files`: os anexos vêm de `SQL_GET_ITEM_RESPONSE_FILES`, em uma
 * segunda consulta. Fazer o join aqui multiplicaria a linha do comentário por
 * anexo, quebrando qualquer consumidor que conte comentários.
 */
const SQL_GET_ITEM_RESPONSES = `
  SELECT
    r.id,
    r.task_item_id_fk,
    r.comment,
    r.status,
    r.created_by_fk,
    r.created_at,
    e.name
  FROM gt_task_item_response r
  LEFT JOIN _employee e ON e.id = r.created_by_fk
  WHERE r.task_item_id_fk = ? AND r.status = 1
  ORDER BY r.created_at ASC
`;

/**
 * Todos os anexos ativos dos comentários ativos de um item, em uma consulta só
 * (o shaper agrupa por `task_item_response_id_fk`).
 * Parâmetros: [task_item_id_fk]
 */
const SQL_GET_ITEM_RESPONSE_FILES = `
  SELECT
    rf.id,
    rf.task_item_response_id_fk,
    rf.file_id,
    rf.file_name,
    f.file_path,
    f.file_extension,
    f.file_type,
    f.file_size,
    f.video_codec,
    rf.processing_status,
    rf.status,
    rf.created_at
  FROM gt_task_item_response_files rf
  INNER JOIN gt_task_item_response r ON r.id = rf.task_item_response_id_fk
  LEFT JOIN _files f ON f.id = rf.file_id
  WHERE r.task_item_id_fk = ? AND r.status = 1 AND rf.status = 1
  ORDER BY rf.id ASC
`;

/** Anexos ativos de UM comentário. Parâmetros: [task_item_response_id_fk] */
const SQL_GET_RESPONSE_FILES = `
  SELECT
    rf.id,
    rf.task_item_response_id_fk,
    rf.file_id,
    rf.file_name,
    f.file_path,
    f.file_extension,
    f.file_type,
    f.file_size,
    f.video_codec,
    rf.processing_status,
    rf.status,
    rf.created_at
  FROM gt_task_item_response_files rf
  LEFT JOIN _files f ON f.id = rf.file_id
  WHERE rf.task_item_response_id_fk = ? AND rf.status = 1
  ORDER BY rf.id ASC
`;

/** Comentário ativo por id — usado para reemitir o evento WS após mexer nos anexos. */
const SQL_FIND_RESPONSE_BY_ID = `
  SELECT id, task_item_id_fk, comment, status, created_by_fk, created_at
  FROM gt_task_item_response
  WHERE id = ? AND status = 1
`;

/**
 * Parâmetros: [task_item_id_fk, comment, created_by_fk, file_id, file_name]
 *
 * @deprecated (só as duas últimas colunas) `file_id`/`file_name` recebem o
 * PRIMEIRO anexo apenas para não quebrar quem ainda lê o formato antigo direto
 * da tabela. A fonte de verdade é `gt_task_item_response_files`. Ao remover as
 * colunas, apagar os dois `?` finais daqui e os dois argumentos no repository.
 */
const SQL_INSERT_TASK_ITEM_RESPONSE = `
  INSERT INTO gt_task_item_response (task_item_id_fk, comment, status, created_by_fk, file_id, file_name)
  VALUES (?, ?, 1, ?, ?, ?)
`;

/** Parâmetros: [task_item_response_id_fk, file_id, file_name, created_by_fk] */
const SQL_INSERT_TASK_ITEM_RESPONSE_FILE = `
  INSERT INTO gt_task_item_response_files (task_item_response_id_fk, file_id, file_name, status, created_by_fk)
  VALUES (?, ?, ?, 1, ?)
`;

const SQL_SOFT_DELETE_RESPONSE = `UPDATE gt_task_item_response SET status = 0 WHERE id = ?`;
const SQL_UPDATE_RESPONSE      = `UPDATE gt_task_item_response SET comment = ? WHERE id = ? AND status = 1`;

/**
 * Soft-delete de UM anexo, sem tocar nos demais do mesmo comentário.
 *
 * O join com o comentário pai deixa o escopo (`item` → `comentário` → `anexo`)
 * dentro do próprio UPDATE: um id de anexo de outro item não afeta linha
 * alguma e o caso de uso devolve 404.
 *
 * O arquivo em `_files` NÃO é soft-deletado: o `FileService` deduplica por
 * hash, então o mesmo `file_id` pode estar referenciado por outro comentário.
 *
 * Parâmetros: [updated_by_fk, id, task_item_response_id_fk, task_item_id_fk]
 */
const SQL_SOFT_DELETE_RESPONSE_FILE = `
  UPDATE gt_task_item_response_files rf
  INNER JOIN gt_task_item_response r ON r.id = rf.task_item_response_id_fk
  SET rf.status = 0, rf.updated_by_fk = ?
  WHERE rf.id = ?
    AND rf.task_item_response_id_fk = ?
    AND r.task_item_id_fk = ?
    AND rf.status = 1
`;

/**
 * Cascata do soft-delete do comentário: os anexos acompanham o pai.
 * Parâmetros: [updated_by_fk, task_item_response_id_fk]
 */
const SQL_SOFT_DELETE_FILES_BY_RESPONSE = `
  UPDATE gt_task_item_response_files
  SET status = 0, updated_by_fk = ?
  WHERE task_item_response_id_fk = ? AND status = 1
`;

/**
 * Resolve o task_id de uma resposta a partir do item pai — elimina a
 * violação de camada em que o controller consultava `gt_task_item`
 * diretamente via `poolGlobal` para poder emitir o evento WebSocket.
 */
const SQL_FIND_TASK_ID_BY_ITEM_ID = `SELECT task_id FROM gt_task_item WHERE id = ?`;

module.exports = {
    SQL_GET_ITEM_RESPONSES,
    SQL_GET_ITEM_RESPONSE_FILES,
    SQL_GET_RESPONSE_FILES,
    SQL_FIND_RESPONSE_BY_ID,
    SQL_INSERT_TASK_ITEM_RESPONSE,
    SQL_INSERT_TASK_ITEM_RESPONSE_FILE,
    SQL_SOFT_DELETE_RESPONSE,
    SQL_SOFT_DELETE_RESPONSE_FILE,
    SQL_SOFT_DELETE_FILES_BY_RESPONSE,
    SQL_UPDATE_RESPONSE,
    SQL_FIND_TASK_ID_BY_ITEM_ID,
};
