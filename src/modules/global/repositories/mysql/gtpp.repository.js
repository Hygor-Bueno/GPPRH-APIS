/**
 * @fileoverview Repositório GTPP — todas as queries SQL do gerenciador de tarefas Peg Pesé.
 * @module modules/global/repositories/mysql/gtpp.repository
 */

'use strict';

// ─── Tasks ────────────────────────────────────────────────────────────────────

/**
 * Monta a query de listagem de tarefas com filtros e paginação opcionais.
 * Espelha o PHP SelectMobile() + montagem do controller (Task.php).
 *
 * @param {object} opts
 * @param {number|null} opts.stateId  - Filtrar por estado (null = todos)
 * @param {number}      opts.limit    - Itens por página (padrão 50)
 * @param {number}      opts.offset   - Offset para paginação
 *
 * Parâmetros posicionais gerados: [userId, userId, userId, ...stateId?, limit, offset]
 *
 * Campos:
 *  - percent    → percentual de itens marcados (0-100)
 *  - colabs_raw → IDs de colaboradores (GROUP_CONCAT), parseado no serviço
 */
function buildGetTasksQuery({ stateId = null, limit = 50, offset = 0 } = {}) {
    // LIMIT/OFFSET são inlinados (não como ?) porque mysql2 prepared statements
    // não aceitam parâmetros posicionais para LIMIT/OFFSET em todas as versões do MySQL.
    // Seguro pois limit e offset sempre vêm de parseInt() no controller.
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

    // Parâmetros posicionais: userId (JOIN), userId (WHERE), userId (WHERE), stateId?
    return { sql, extraParams: stateId != null ? [stateId] : [] };
}

/**
 * Detalhes completos de uma tarefa pelo ID.
 * Requer 2 parâmetros: userId (para o JOIN de tema), taskId.
 */
const SQL_GET_TASK_BY_ID = `
  SELECT
    t.id,
    t.description,
    t.full_description,
    t.user_id,
    ts.id AS state_id,
    ts.description AS state_description,
    t.priority,
    t.initial_date,
    t.final_date,
    t.disqualify,
    DATEDIFF(t.final_date, CURDATE()) AS expire,
    MAX(th.description_theme) AS description_theme,
    COALESCE(MAX(th.id_theme), 0) AS theme_id_fk,
    e.name AS creator_name,
    ROUND(COALESCE(
      (SELECT COUNT(i.id) FROM gt_task_item i WHERE i.task_id = t.id AND i.\`check\` = 1 AND i.status = 1)
      / NULLIF((SELECT COUNT(i.id) FROM gt_task_item i WHERE i.task_id = t.id AND i.status = 1), 0)
      * 100, 0
    )) AS percent
  FROM gt_task t
  INNER JOIN gt_task_state ts ON ts.id = t.state_id
  LEFT JOIN _employee e ON e.id = t.user_id
  LEFT JOIN gt_task_user tu ON tu.task_id = t.id AND tu.user_id = ?
  LEFT JOIN gt_theme th ON th.id_theme = tu.theme_id_fk
  WHERE t.id = ?
  GROUP BY t.id, t.description, t.full_description, t.user_id,
           ts.id, ts.description, t.priority, t.initial_date, t.final_date,
           t.disqualify, e.name
`;

const SQL_GET_TASK_USER_ID = `SELECT user_id FROM gt_task WHERE id = ?`;
const SQL_GET_TASK_STATE   = `SELECT state_id FROM gt_task WHERE id = ?`;

/**
 * Cria uma nova tarefa.
 * Parâmetros: description, full_description, user_id, priority, initial_date, final_date
 */
const SQL_INSERT_TASK = `
  INSERT INTO gt_task (description, full_description, user_id, priority, initial_date, final_date)
  VALUES (?, ?, ?, ?, ?, ?)
`;

/**
 * Registra o criador da tarefa como usuário vinculado automaticamente.
 * Parâmetros: task_id, user_id, theme_id_fk (null se não informado)
 */
const SQL_INSERT_TASK_USER_SELF = `
  INSERT INTO gt_task_user (task_id, user_id, theme_id_fk) VALUES (?, ?, ?)
`;

/** Atualiza o título (description) da tarefa. */
const SQL_UPDATE_TASK_TITLE = `UPDATE gt_task SET description = ? WHERE id = ?`;

/** Atualiza a descrição longa (full_description) da tarefa. */
const SQL_UPDATE_TASK_DESCRIPTION = `UPDATE gt_task SET full_description = ? WHERE id = ?`;

/**
 * Atualiza o tema por usuário/tarefa (armazenado em gt_task_user, não em gt_task).
 * Parâmetros: theme_id_fk, task_id, user_id
 */
const SQL_UPDATE_TASK_THEME = `
  UPDATE gt_task_user SET theme_id_fk = ? WHERE task_id = ? AND user_id = ?
`;

const SQL_DELETE_TASK = `DELETE FROM gt_task WHERE id = ?`;

/** Chama a SP que atualiza estado e registra histórico (requer que p_user_id seja o criador). */
const SQL_UPDATE_TASK_STATE = `CALL UpdateStateAndTaskHistory(?, ?, ?, ?)`;

/**
 * Atualização direta de estado — usada por transições AUTOMÁTICAS do sistema
 * (autoBeginTask, autoToggleAnalyzing) que não passam pela SP pois não há
 * verificação de criador: qualquer participante pode disparar a transição.
 * Parâmetros: [state_id, task_id]
 */
const SQL_AUTO_UPDATE_TASK_STATE  = `UPDATE gt_task SET state_id = ? WHERE id = ?`;
const SQL_EXTEND_TASK_FINAL_DATE  = `UPDATE gt_task SET final_date = DATE_ADD(CURDATE(), INTERVAL ? DAY) WHERE id = ?`;

/**
 * Insere um registro no histórico da tarefa.
 * Parâmetros: [description, state_id, task_id]
 */
const SQL_INSERT_TASK_HISTORIC = `
  INSERT INTO gt_task_historic (description, state_id, task_id, date_time)
  VALUES (?, ?, ?, NOW())
`;

/**
 * Complementa o último registro de histórico da tarefa (inserido pela SP)
 * com o state_id, evitando duplicação.
 * Parâmetros: [state_id, task_id]
 */
const SQL_PATCH_LAST_HISTORIC_STATE = `
  UPDATE gt_task_historic
  SET state_id = ?
  WHERE task_id = ? AND state_id IS NULL
  ORDER BY id DESC
  LIMIT 1
`;

/** Lista o histórico de uma tarefa em ordem decrescente. */
const SQL_GET_TASK_HISTORIC = `
  SELECT h.id, h.description, h.state_id, h.date_time,
         ts.description AS state_description, ts.color AS state_color
  FROM gt_task_historic h
  LEFT JOIN gt_task_state ts ON ts.id = h.state_id
  WHERE h.task_id = ?
  ORDER BY h.date_time DESC
`;

// ─── Task Items ───────────────────────────────────────────────────────────────

/** Retorna as datas de início e fim da tarefa pai (para validação de datas de itens). */
const SQL_GET_TASK_DATES = `
  SELECT initial_date, final_date FROM gt_task WHERE id = ?
`;

/**
 * Itens ativos de uma tarefa com total de comentários.
 * Espelha o método NewSelect() do PHP (TaskItem.php).
 * A coluna `file` retorna 0/1 (indica presença de arquivo).
 * Campos calculados:
 *   deadline_percent → % do prazo decorrido do item (0–100), NULL se sem datas
 *   overdue          → 1 se final_date do item já passou, 0 caso contrário
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
    -- 1 se tem arquivo (novo ou legado), 0 se não tem
    CASE WHEN t.file_id IS NOT NULL OR t.file IS NOT NULL THEN 1 ELSE 0 END AS file,
    -- file_id exposto para o front identificar arquivos do novo sistema
    t.file_id,
    t.note,
    t.initial_date,
    t.final_date,
    -- Percentual de prazo decorrido: (hoje - início) / (fim - início) × 100, limitado a 0–100
    CASE
      WHEN t.initial_date IS NULL OR t.final_date IS NULL THEN NULL
      ELSE LEAST(GREATEST(
        ROUND(DATEDIFF(CURDATE(), t.initial_date) / NULLIF(DATEDIFF(t.final_date, t.initial_date), 0) * 100),
        0
      ), 100)
    END AS deadline_percent,
    -- overdue: 1 se o prazo do item já passou
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
const SQL_UPDATE_ITEM_FILE        = `UPDATE gt_task_item SET file_id = ?, file_name = ? WHERE id = ? AND task_id = ?`;

/** Limpa o arquivo de um item (remove o vínculo com _files e o nome snapshot). */
const SQL_CLEAR_ITEM_FILE         = `UPDATE gt_task_item SET file_id = NULL, file_name = NULL WHERE id = ? AND task_id = ?`;

/**
 * Recupera referências de arquivo de um item.
 * file_id → novo sistema (_files FK)
 * file    → legado (BLOB, somente leitura histórica)
 */
const SQL_GET_ITEM_FILE           = `SELECT file_id, file FROM gt_task_item WHERE id = ?`;

const SQL_UPDATE_ITEM_NOTE        = `UPDATE gt_task_item SET note = ? WHERE id = ? AND task_id = ?`;
const SQL_UPDATE_ITEM_STATUS      = `UPDATE gt_task_item SET status = ? WHERE id = ? AND task_id = ?`;
const SQL_SOFT_DELETE_ITEM        = `UPDATE gt_task_item SET status = 0 WHERE id = ? AND task_id = ?`;
const SQL_UPDATE_ITEM_ORDER       = `UPDATE gt_task_item SET \`order\` = ? WHERE id = ?`;

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

/**
 * Contagem de itens ativos e "concluídos" para auto-transição de estado.
 *
 * Regras:
 *  - yes_no = -1  → questão ainda sem resposta: EXCLUÍDA do total
 *                   (não bloqueia a transição enquanto estiver aberta)
 *  - yes_no =  0  → item comum: concluído quando check = 1
 *  - yes_no = 1|2 → questão respondida (sim/não): sempre conta como concluída
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

// ─── Task Item Responses ──────────────────────────────────────────────────────

/**
 * Respostas/evidências de um item com arquivos e nome do autor.
 * FK correta: task_item_id_fk (não task_item_id).
 * Espelha SelectByCommentId() do PHP (TaskItemResponse.php).
 */
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

const SQL_INSERT_TASK_ITEM_RESPONSE = `
  INSERT INTO gt_task_item_response (task_item_id_fk, comment, status, created_by_fk, file_id, file_name)
  VALUES (?, ?, 1, ?, ?, ?)
`;

const SQL_SOFT_DELETE_RESPONSE  = `UPDATE gt_task_item_response SET status = 0 WHERE id = ?`;
const SQL_UPDATE_RESPONSE       = `UPDATE gt_task_item_response SET comment = ? WHERE id = ? AND status = 1`;

// ─── Task Users ───────────────────────────────────────────────────────────────

/**
 * Lista todos os usuários com acesso GTPP, marcando os vinculados à tarefa.
 * Exclui o próprio criador da tarefa (já implícito como dono).
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

/**
 * Usuários vinculados à tarefa para o detalhe (espelha PHP getTaskDataFull).
 * Retorna task_id, user_id, status, theme_id_fk, name e photo.
 * Inclui TODOS os vinculados (criador + colaboradores).
 */
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

/**
 * Unidades de negócio (empresa/loja/depto) vinculadas à tarefa.
 * Espelha PHP getShopTask().
 */
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

// ─── Task Scope ───────────────────────────────────────────────────────────────

const SQL_GET_TASK_SCOPE = `
  SELECT id, task_id, company_code, branch_code, cost_center_code
  FROM gt_task_scope
  WHERE task_id = ?
  ORDER BY id ASC
`;

const SQL_INSERT_TASK_SCOPE = `
  INSERT INTO gt_task_scope (task_id, company_code, branch_code, cost_center_code)
  VALUES (?, ?, ?, ?)
`;

const SQL_DELETE_TASK_SCOPE = `
  DELETE FROM gt_task_scope WHERE id = ? AND task_id = ?
`;

const SQL_CHECK_USER_IN_TASK = `
  SELECT (
    (SELECT COUNT(task_id) FROM gt_task_user WHERE task_id = ? AND user_id = ?) +
    (SELECT COUNT(id) FROM gt_task WHERE id = ? AND user_id = ?)
  ) AS count
`;

const SQL_INSERT_TASK_USER = `INSERT INTO gt_task_user (task_id, user_id) VALUES (?, ?)`;
const SQL_DELETE_TASK_USER = `DELETE FROM gt_task_user WHERE task_id = ? AND user_id = ?`;

// ─── Messages (chat da tarefa) ────────────────────────────────────────────────

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

// ─── Notifications ────────────────────────────────────────────────────────────

const SQL_GET_NOTIFICATIONS        = `SELECT id, user_id, send_user_id, task_id, type, object FROM gt_notify WHERE user_id = ?`;
const SQL_INSERT_NOTIFICATION      = `INSERT INTO gt_notify (user_id, send_user_id, task_id, type, object) VALUES (?, ?, ?, ?, ?)`;
const SQL_DELETE_NOTIFICATION      = `DELETE FROM gt_notify WHERE id = ?`;
const SQL_DELETE_ALL_NOTIFICATIONS = `DELETE FROM gt_notify WHERE user_id = ?`;

// ─── Themes ───────────────────────────────────────────────────────────────────

const SQL_GET_ALL_THEMES     = `SELECT id_theme, description_theme, user_id_fk FROM gt_theme ORDER BY id_theme DESC`;
const SQL_GET_THEME_BY_ID    = `SELECT id_theme, description_theme, user_id_fk FROM gt_theme WHERE id_theme = ?`;
const SQL_GET_THEMES_BY_USER = `SELECT id_theme, description_theme, user_id_fk FROM gt_theme WHERE user_id_fk = ? ORDER BY id_theme DESC`;
const SQL_INSERT_THEME       = `INSERT INTO gt_theme (description_theme, user_id_fk) VALUES (?, ?)`;
const SQL_UPDATE_THEME       = `UPDATE gt_theme SET description_theme = ? WHERE id_theme = ?`;
const SQL_DELETE_THEME       = `DELETE FROM gt_theme WHERE id_theme = ?`;

// ─── Score ────────────────────────────────────────────────────────────────────

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

/** Lista todos os estados de tarefa disponíveis. Equivalente ao TaskState.php do PHP. */
const SQL_GET_TASK_STATES = `
  SELECT id, description, color
  FROM gt_task_state
  ORDER BY id ASC
`;

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
    // Tasks
    buildGetTasksQuery,
    SQL_GET_TASK_BY_ID,
    SQL_GET_TASK_USER_ID,
    SQL_GET_TASK_STATE,
    SQL_INSERT_TASK,
    SQL_INSERT_TASK_USER_SELF,
    SQL_UPDATE_TASK_TITLE,
    SQL_UPDATE_TASK_DESCRIPTION,
    SQL_UPDATE_TASK_THEME,
    SQL_DELETE_TASK,
    SQL_UPDATE_TASK_STATE,
    SQL_AUTO_UPDATE_TASK_STATE,
    SQL_EXTEND_TASK_FINAL_DATE,
    SQL_INSERT_TASK_HISTORIC,
    SQL_GET_TASK_HISTORIC,
    SQL_PATCH_LAST_HISTORIC_STATE,

    // Task Items
    SQL_GET_TASK_ITEMS,
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
    SQL_UPDATE_ITEM_NOTE,
    SQL_UPDATE_ITEM_STATUS,
    SQL_SOFT_DELETE_ITEM,
    SQL_UPDATE_ITEM_ORDER,
    SQL_GET_ITEM_PREV,
    SQL_GET_ITEM_NEXT,
    SQL_COUNT_ITEM_STATS,

    // Task Item Responses
    SQL_GET_ITEM_RESPONSES,
    SQL_INSERT_TASK_ITEM_RESPONSE,
    SQL_SOFT_DELETE_RESPONSE,
    SQL_UPDATE_RESPONSE,

    // Task Users
    SQL_GET_TASK_USERS,
    SQL_GET_TASK_DETAIL_USERS,
    SQL_GET_TASK_CSDS,
    SQL_GET_TASK_SCOPE,
    SQL_INSERT_TASK_SCOPE,
    SQL_DELETE_TASK_SCOPE,
    SQL_CHECK_USER_IN_TASK,
    SQL_INSERT_TASK_USER,
    SQL_DELETE_TASK_USER,

    // Messages
    SQL_GET_TASK_MESSAGES,
    SQL_GET_MESSAGE_BY_ID,
    SQL_INSERT_MESSAGE,
    SQL_UPDATE_MSG_FILE,
    SQL_DELETE_MESSAGE,

    // Notifications
    SQL_GET_NOTIFICATIONS,
    SQL_INSERT_NOTIFICATION,
    SQL_DELETE_NOTIFICATION,
    SQL_DELETE_ALL_NOTIFICATIONS,

    // Themes
    SQL_GET_ALL_THEMES,
    SQL_GET_THEME_BY_ID,
    SQL_GET_THEMES_BY_USER,
    SQL_INSERT_THEME,
    SQL_UPDATE_THEME,
    SQL_DELETE_THEME,

    // Score
    SQL_GET_SCORE,
    SQL_GET_DISQUALIFY,
    SQL_UPDATE_DISQUALIFY,
    SQL_GET_ALL_USERS_WITH_ACCESS,
    SQL_GET_TASK_STATES,
};
