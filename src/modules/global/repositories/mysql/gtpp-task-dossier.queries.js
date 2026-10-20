/**
 * @fileoverview Queries SQL puras — sub-feature Task Dossier (GTPP).
 *
 * Leitura completa de UMA tarefa para o PDF "Dossiê da tarefa". Cada consulta
 * traz o bloco inteiro da tarefa de uma vez (comentários e anexos de todos os
 * itens juntos), para o dossiê não fazer uma ida ao banco por item.
 *
 * Histórico e escopo reaproveitam as constantes canônicas de
 * `gtpp-task.queries.js` e `gtpp-task-scope.queries.js`.
 *
 * Datas saem como texto local sem fuso: DATE por `DATE_FORMAT('%Y-%m-%d')`,
 * DATETIME por `localDateTime()`. `gt_message.date_time` já é VARCHAR local.
 *
 * @module modules/global/repositories/mysql/gtpp-task-dossier.queries
 */

'use strict';

const { localDateTime } = require('./mysql-datetime.sql');

/** Cabeçalho da tarefa, com estado e criador. Parâmetros: [taskId] */
const SQL_DOSSIER_TASK = `
  SELECT
    t.id,
    t.description AS title,
    t.full_description,
    t.priority,
    DATE_FORMAT(t.initial_date, '%Y-%m-%d') AS initial_date,
    DATE_FORMAT(t.final_date,   '%Y-%m-%d') AS final_date,
    DATEDIFF(t.final_date, CURDATE()) AS days_to_deadline,
    t.disqualify,
    t.state_id,
    ts.description AS state_description,
    ts.color       AS state_color,
    t.user_id      AS creator_id,
    UPPER(u.name)  AS creator_name
  FROM gt_task t
  LEFT JOIN gt_task_state ts ON ts.id = t.state_id
  LEFT JOIN _user u ON u.id = t.user_id
  WHERE t.id = ?
`;

/** Nome de quem está gerando o dossiê. Parâmetros: [userId] */
const SQL_DOSSIER_VIEWER = `SELECT id, UPPER(name) AS name FROM _user WHERE id = ?`;

/**
 * Participantes: vinculados + criador (o criador normalmente já está em
 * `gt_task_user`, o UNION cobre tarefas antigas em que não está).
 * Parâmetros: [taskId, taskId]
 */
const SQL_DOSSIER_PARTICIPANTS = `
  SELECT
    u.id,
    UPPER(u.name) AS name,
    IF(u.ad_status = 'active', 1, 0) AS active,
    u.file_id     AS photo_file_id,
    f.file_path   AS photo_file_path,
    f.file_type   AS photo_file_type
  FROM (
    SELECT user_id FROM gt_task_user WHERE task_id = ?
    UNION
    SELECT user_id FROM gt_task WHERE id = ?
  ) p
  INNER JOIN _user u ON u.id = p.user_id
  LEFT JOIN _files f ON f.id = u.file_id AND f.status = 1
`;

/**
 * Itens ativos. `deadline_percent` usa a mesma conta de `SQL_GET_TASK_ITEMS`
 * (o item de um dia só é resolvido no repositório por
 * `computeDeadlinePercent`).
 *
 * Arquivo do item: `file_id` → `_files`; o BLOB legado (`file`) entra só como
 * presença e tamanho — o conteúdo nunca é lido aqui.
 * Parâmetros: [taskId]
 */
const SQL_DOSSIER_ITEMS = `
  SELECT
    i.id,
    i.\`order\`,
    i.description,
    i.\`check\`,
    i.yes_no,
    i.note,
    DATE_FORMAT(i.initial_date, '%Y-%m-%d') AS initial_date,
    DATE_FORMAT(i.final_date,   '%Y-%m-%d') AS final_date,
    CASE
      WHEN i.initial_date IS NULL OR i.final_date IS NULL THEN NULL
      ELSE LEAST(GREATEST(
        ROUND(DATEDIFF(CURDATE(), i.initial_date) / NULLIF(DATEDIFF(i.final_date, i.initial_date), 0) * 100),
        0
      ), 100)
    END AS deadline_percent,
    CASE WHEN i.final_date IS NOT NULL AND i.final_date < CURDATE() THEN 1 ELSE 0 END AS overdue,
    i.assigned_to,
    UPPER(au.name) AS assigned_name,
    i.file_id,
    i.file_name,
    f.file_path,
    f.file_type,
    f.file_size,
    IF(i.file_id IS NULL AND i.file IS NOT NULL, 1, 0) AS has_legacy_blob,
    IF(i.file_id IS NULL AND i.file IS NOT NULL, LENGTH(i.file), NULL) AS legacy_blob_size
  FROM gt_task_item i
  LEFT JOIN _user au ON au.id = i.assigned_to
  LEFT JOIN _files f ON f.id = i.file_id
  WHERE i.task_id = ? AND i.status = 1
  ORDER BY i.\`order\` ASC
`;

/** Comentários ativos de todos os itens ativos da tarefa. Parâmetros: [taskId] */
const SQL_DOSSIER_RESPONSES = `
  SELECT
    r.id,
    r.task_item_id_fk,
    r.comment,
    ${localDateTime('r.created_at')},
    UPPER(u.name) AS author
  FROM gt_task_item_response r
  INNER JOIN gt_task_item i ON i.id = r.task_item_id_fk AND i.status = 1
  LEFT JOIN _user u ON u.id = r.created_by_fk
  WHERE i.task_id = ? AND r.status = 1
  ORDER BY r.created_at ASC, r.id ASC
`;

/** Anexos ativos dos comentários ativos da tarefa. Parâmetros: [taskId] */
const SQL_DOSSIER_RESPONSE_FILES = `
  SELECT
    rf.id,
    rf.task_item_response_id_fk,
    rf.file_name,
    rf.processing_status,
    f.file_path,
    f.file_type,
    f.file_size
  FROM gt_task_item_response_files rf
  INNER JOIN gt_task_item_response r ON r.id = rf.task_item_response_id_fk AND r.status = 1
  INNER JOIN gt_task_item i ON i.id = r.task_item_id_fk AND i.status = 1
  LEFT JOIN _files f ON f.id = rf.file_id
  WHERE i.task_id = ? AND rf.status = 1
  ORDER BY rf.id ASC
`;

/**
 * As N mensagens mais recentes do chat (o template ordena por data).
 * LIMIT inlinado pelo builder — mesmo motivo de `buildGetTasksQuery`.
 * Parâmetros: [taskId]
 */
function buildDossierMessagesQuery(limit) {
    const safeLimit = parseInt(limit, 10) || 200;
    return `
  SELECT
    m.id,
    m.description,
    m.date_time,
    UPPER(u.name) AS author,
    m.file_id,
    m.file_name,
    f.file_type,
    f.file_size
  FROM gt_message m
  LEFT JOIN _user u ON u.id = m.user_id
  LEFT JOIN _files f ON f.id = m.file_id
  WHERE m.task_id = ?
  ORDER BY m.id DESC
  LIMIT ${safeLimit}
`;
}

/** Total real de mensagens, para o aviso de truncamento. Parâmetros: [taskId] */
const SQL_DOSSIER_MESSAGES_COUNT = `SELECT COUNT(*) AS total FROM gt_message WHERE task_id = ?`;

module.exports = {
    SQL_DOSSIER_TASK,
    SQL_DOSSIER_VIEWER,
    SQL_DOSSIER_PARTICIPANTS,
    SQL_DOSSIER_ITEMS,
    SQL_DOSSIER_RESPONSES,
    SQL_DOSSIER_RESPONSE_FILES,
    buildDossierMessagesQuery,
    SQL_DOSSIER_MESSAGES_COUNT,
};
