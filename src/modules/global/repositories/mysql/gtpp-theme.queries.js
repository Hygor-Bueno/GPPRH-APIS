/**
 * @fileoverview Consultas SQL puras para temas GTPP (gt_theme).
 *
 * @module modules/global/repositories/mysql/gtpp-theme.queries
 */

const SQL_GET_ALL_THEMES     = `SELECT id_theme, description_theme, user_id_fk FROM gt_theme ORDER BY id_theme DESC`;
const SQL_GET_THEME_BY_ID    = `SELECT id_theme, description_theme, user_id_fk FROM gt_theme WHERE id_theme = ?`;
const SQL_GET_THEMES_BY_USER = `SELECT id_theme, description_theme, user_id_fk FROM gt_theme WHERE user_id_fk = ? ORDER BY id_theme DESC`;
const SQL_INSERT_THEME       = `INSERT INTO gt_theme (description_theme, user_id_fk) VALUES (?, ?)`;
const SQL_UPDATE_THEME       = `UPDATE gt_theme SET description_theme = ? WHERE id_theme = ?`;
const SQL_DELETE_THEME       = `DELETE FROM gt_theme WHERE id_theme = ?`;

module.exports = {
    SQL_GET_ALL_THEMES,
    SQL_GET_THEME_BY_ID,
    SQL_GET_THEMES_BY_USER,
    SQL_INSERT_THEME,
    SQL_UPDATE_THEME,
    SQL_DELETE_THEME,
};
