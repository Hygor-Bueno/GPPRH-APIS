/**
 * @fileoverview Consultas SQL puras para `meipp_audit_log`.
 *
 * @module modules/global/repositories/mysql/meipp-audit.queries
 */

/**
 * Parâmetros: `[user_id, action, entity_type, entity_id, detail]`
 *
 * `detail` é JSON — o driver recebe a string já serializada pelo adapter.
 */
const SQL_INSERT_AUDIT = `
    INSERT INTO meipp_audit_log (user_id, action, entity_type, entity_id, detail)
    VALUES (?, ?, ?, ?, ?)
`;

/**
 * Trilha paginada e filtrável.
 *
 * Parâmetros: `[entity_type, entity_type, user_id, user_id, limit, offset]`
 */
const SQL_LIST_AUDIT = `
    SELECT a.id, a.user_id, a.action, a.entity_type, a.entity_id, a.detail,
           a.created_at, u.name AS user_name
    FROM meipp_audit_log a
    LEFT JOIN meipp_users u ON u.id = a.user_id
    WHERE (? IS NULL OR a.entity_type = ?)
      AND (? IS NULL OR a.user_id = ?)
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ? OFFSET ?
`;

const SQL_COUNT_AUDIT = `
    SELECT COUNT(*) AS total
    FROM meipp_audit_log
    WHERE (? IS NULL OR entity_type = ?)
      AND (? IS NULL OR user_id = ?)
`;

module.exports = { SQL_INSERT_AUDIT, SQL_LIST_AUDIT, SQL_COUNT_AUDIT };
