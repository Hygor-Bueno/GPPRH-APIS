/**
 * @fileoverview Queries SQL puras — sub-feature Task (GTPP).
 * @module modules/global/repositories/mysql/gtpp-task.queries
 */

'use strict';

/**
 * Monta a query de listagem de tarefas com filtros e paginação opcionais.
 *
 * @param {object} opts
 * @param {number|null} opts.stateId - Filtrar por estado (null = todos)
 * @param {number}      opts.limit   - Itens por página (padrão 50)
 * @param {number}      opts.offset  - Offset para paginação
 *
 * Parâmetros posicionais gerados: [userId, userId, userId, ...stateId?]
 * (LIMIT/OFFSET inlinados — mysql2 prepared statements não aceitam ? em LIMIT/OFFSET
 * em todas as versões do MySQL; seguro pois ambos vêm de parseInt() no controller.)
 */
function buildGetTasksQuery({ stateId = null, limit = 50, offset = 0 } = {}) {
    const safeLimit  = parseInt(limit,  10) || 50;
    const safeOffset = parseInt(offset, 10) || 0;
    const stateFilter = stateId != null ? 'AND t.state_id = ?' : '';

    const sql = `
  SELECT
    t.id,
    t.description,
    t.user_id,
    ts.description AS state_description,
    MAX(th.description_theme) AS description_theme,
    COALESCE(MAX(th.id_theme), 0) AS theme_id_fk,
    ts.id AS state_id,
    t.priority,
    t.initial_date,
    t.final_date,
    COALESCE(task_users.total_users, 0) AS users,
    DATEDIFF(t.final_date, CURDATE()) AS expire,
    ROUND(COALESCE(
      (SELECT COUNT(i.id) FROM gt_task_item i WHERE i.task_id = t.id AND i.\`check\` = 1 AND i.status = 1)
      / NULLIF((SELECT COUNT(i.id) FROM gt_task_item i WHERE i.task_id = t.id AND i.status = 1), 0)
      * 100, 0
    )) AS percent,
    (
      SELECT GROUP_CONCAT(tu2.user_id ORDER BY tu2.user_id)
      FROM gt_task_user tu2
      WHERE tu2.task_id = t.id
    ) AS colabs_raw
  FROM gt_task t
  INNER JOIN gt_task_state ts ON t.state_id = ts.id
  INNER JOIN _user u ON t.user_id = u.id

  LEFT JOIN gt_task_user tu ON tu.task_id = t.id AND tu.user_id = ?
  LEFT JOIN gt_theme th ON th.id_theme = tu.theme_id_fk
  LEFT JOIN (
    SELECT task_id, COUNT(*) AS total_users
    FROM gt_task_user GROUP BY task_id
  ) task_users ON task_users.task_id = t.id
  WHERE (t.user_id = ? OR tu.user_id = ?)
  ${stateFilter}
  GROUP BY t.id, t.description, t.user_id, ts.description, ts.id,
           t.priority, t.initial_date, t.final_date, task_users.total_users
  ORDER BY t.id DESC
  LIMIT ${safeLimit} OFFSET ${safeOffset}
    `;

    return { sql, extraParams: stateId != null ? [stateId] : [] };
}

/** Descrição completa + estado de uma tarefa, para montagem do detalhe (getTaskById). */
const SQL_GET_TASK_DETAIL = `SELECT full_description, state_id FROM gt_task WHERE id = ?`;

/**
 * Cria uma nova tarefa.
 * Parâmetros: description, full_description, user_id, priority, initial_date, final_date
 */
const SQL_INSERT_TASK = `
  INSERT INTO gt_task (description, full_description, user_id, priority, initial_date, final_date)
  VALUES (?, ?, ?, ?, ?, ?)
`;

/** Registra o criador da tarefa como usuário vinculado automaticamente. Parâmetros: task_id, user_id, theme_id_fk. */
const SQL_INSERT_TASK_USER_SELF = `
  INSERT INTO gt_task_user (task_id, user_id, theme_id_fk) VALUES (?, ?, ?)
`;

/** Atualiza o título (description) da tarefa. */
const SQL_UPDATE_TASK_TITLE = `UPDATE gt_task SET description = ? WHERE id = ?`;

/** Atualiza a descrição longa (full_description) da tarefa. */
const SQL_UPDATE_TASK_DESCRIPTION = `UPDATE gt_task SET full_description = ? WHERE id = ?`;

/** Atualiza o tema por usuário/tarefa (armazenado em gt_task_user). Parâmetros: theme_id_fk, task_id, user_id */
const SQL_UPDATE_TASK_THEME = `
  UPDATE gt_task_user SET theme_id_fk = ? WHERE task_id = ? AND user_id = ?
`;

const SQL_DELETE_TASK = `DELETE FROM gt_task WHERE id = ?`;

/** Estende o prazo final da tarefa em N dias a partir de hoje. Parâmetros: [days, task_id] */
const SQL_EXTEND_TASK_FINAL_DATE = `UPDATE gt_task SET final_date = DATE_ADD(CURDATE(), INTERVAL ? DAY) WHERE id = ?`;

/** Lista o histórico de uma tarefa em ordem decrescente. */
const SQL_GET_TASK_HISTORIC = `
  SELECT h.id, h.description, h.state_id, h.date_time,
         ts.description AS state_description, ts.color AS state_color
  FROM gt_task_historic h
  LEFT JOIN gt_task_state ts ON ts.id = h.state_id
  WHERE h.task_id = ?
  ORDER BY h.date_time DESC
`;

/** Todos os estados de tarefa disponíveis. */
const SQL_GET_TASK_STATES = `
  SELECT id, description, color
  FROM gt_task_state
  ORDER BY id ASC
`;

/**
 * Itens ativos de uma tarefa com total de comentários (usado no detalhe getTaskById).
 * A coluna `file` retorna 0/1 (indica presença de arquivo).
 */
const SQL_GET_TASK_ITEMS = `
  SELECT
    t.id,
    t.description,
    t.\`check\`,
    t.task_id,
    t.\`order\`,
    t.yes_no,
    t.created_by,
    t.assigned_to,
    t.created_at,
    t.updated_by,
    t.updated_at,
    t.status,
    CASE WHEN t.file_id IS NOT NULL OR t.file IS NOT NULL THEN 1 ELSE 0 END AS file,
    t.file_id,
    t.note,
    t.initial_date,
    t.final_date,
    CASE
      WHEN t.initial_date IS NULL OR t.final_date IS NULL THEN NULL
      ELSE LEAST(GREATEST(
        ROUND(DATEDIFF(CURDATE(), t.initial_date) / NULLIF(DATEDIFF(t.final_date, t.initial_date), 0) * 100),
        0
      ), 100)
    END AS deadline_percent,
    CASE WHEN t.final_date IS NOT NULL AND t.final_date < CURDATE() THEN 1 ELSE 0 END AS overdue,
    COALESCE(r.total_comment, 0) AS total_comment,
    e.name AS assigned_name
  FROM gt_task_item AS t
  LEFT JOIN (
    SELECT task_item_id_fk, COUNT(*) AS total_comment
    FROM gt_task_item_response r
    WHERE r.status = 1
    GROUP BY task_item_id_fk
  ) AS r ON r.task_item_id_fk = t.id
  LEFT JOIN _employee e ON e.id = t.assigned_to
  WHERE t.task_id = ? AND t.status = 1
  ORDER BY t.\`order\` ASC
`;

/** Usuários vinculados a uma tarefa (com foto), para o detalhe getTaskById. */
const SQL_GET_TASK_DETAIL_USERS = `
  SELECT
    gtu.task_id,
    gtu.user_id,
    IF(_u.status = 1, true, false) AS status,
    gtu.theme_id_fk,
    e.name,
    e.photo
  FROM gt_task_user gtu
  INNER JOIN _user _u ON _u.id = gtu.user_id
  INNER JOIN _employee e ON e.id = gtu.user_id
  WHERE gtu.task_id = ?
`;

/** Unidades de negócio (empresa/loja/depto) vinculadas à tarefa. */
const SQL_GET_TASK_CSDS = `
  SELECT
    c.id   AS company_id,   c.description AS company_description,
    s.id   AS shop_id,      s.description AS shop_description,
    d.id   AS depart_id,    d.description AS depart_description
  FROM gt_task_csds csds
  INNER JOIN _com_sho_dep_sub _csds ON csds.csds_id = _csds.id
  INNER JOIN _company      c ON _csds.company_id = c.id
  INNER JOIN _shop         s ON _csds.shop_id    = s.id
  INNER JOIN _departament  d ON _csds.depart_id  = d.id
  WHERE csds.task_id = ?
  GROUP BY company_id, shop_id, depart_id
`;

module.exports = {
    buildGetTasksQuery,
    SQL_GET_TASK_DETAIL,
    SQL_INSERT_TASK,
    SQL_INSERT_TASK_USER_SELF,
    SQL_UPDATE_TASK_TITLE,
    SQL_UPDATE_TASK_DESCRIPTION,
    SQL_UPDATE_TASK_THEME,
    SQL_DELETE_TASK,
    SQL_EXTEND_TASK_FINAL_DATE,
    SQL_GET_TASK_HISTORIC,
    SQL_GET_TASK_STATES,
    SQL_GET_TASK_ITEMS,
    SQL_GET_TASK_DETAIL_USERS,
    SQL_GET_TASK_CSDS,
};
