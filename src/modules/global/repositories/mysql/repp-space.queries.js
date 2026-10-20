/**
 * @fileoverview SQL de `re_spaces`, `re_space_admins` e
 * `re_space_unblocked_dates` (REPP). Datas de auditoria saem por
 * `localDateTime()` (hora local sem fuso).
 *
 * @module modules/global/repositories/mysql/repp-space.queries
 */

const { localDateTime } = require('./mysql-datetime.sql');

const SPACE_COLUMNS = 'id, name, description, blocked_weekdays, setup_minutes, active';

const SQL_LIST_ACTIVE_SPACES = `
    SELECT ${SPACE_COLUMNS}
      FROM re_spaces
     WHERE active = 1
     ORDER BY name`;

/** Ativos e inativos — a tela de gestão reativa espaço desativado. */
const SQL_LIST_ALL_SPACES = `
    SELECT ${SPACE_COLUMNS}
      FROM re_spaces
     ORDER BY active DESC, name`;

const SQL_INSERT_SPACE = `
    INSERT INTO re_spaces (name, description, blocked_weekdays, setup_minutes)
    VALUES (?, ?, ?, ?)`;

/** `SET ?` com objeto: as colunas vêm da lista fechada do adapter, nunca do corpo. */
const SQL_UPDATE_SPACE = `
    UPDATE re_spaces
       SET ?
     WHERE id = ?`;

/** Administradores iniciais do espaço novo, em lote (`VALUES ?`). */
const SQL_INSERT_SPACE_ADMINS = `
    INSERT IGNORE INTO re_space_admins (space_id, user_id, created_by)
    VALUES ?`;

const SQL_GET_SPACE_BY_ID = `
    SELECT ${SPACE_COLUMNS}
      FROM re_spaces
     WHERE id = ?`;

/** Ativos ou não: o vínculo é a permissão; quem filtra ativo é quem lista. */
const SQL_LIST_MANAGED_SPACE_IDS = `
    SELECT space_id
      FROM re_space_admins
     WHERE user_id = ?`;

/** Administradores ativos do espaço — usuário bloqueado não recebe aviso. */
const SQL_LIST_SPACE_ADMIN_IDS = `
    SELECT a.user_id
      FROM re_space_admins a
      JOIN _user u ON u.id = a.user_id
     WHERE a.space_id = ?
       AND u.ad_status = 'active'`;

/** Datas liberadas de hoje em diante, dos espaços pedidos. */
const SQL_LIST_UNBLOCKED_DATES = `
    SELECT space_id, DATE_FORMAT(unblock_date, '%Y-%m-%d') AS unblock_date
      FROM re_space_unblocked_dates
     WHERE space_id IN (?)
       AND unblock_date >= ?
     ORDER BY unblock_date`;

const SQL_IS_DATE_UNBLOCKED = `
    SELECT 1
      FROM re_space_unblocked_dates
     WHERE space_id = ?
       AND unblock_date = ?
     LIMIT 1`;

/** Idempotente: liberar de novo a mesma data não muda nada (nem o autor). */
const SQL_INSERT_UNBLOCKED_DATE = `
    INSERT IGNORE INTO re_space_unblocked_dates (space_id, unblock_date, created_by)
    VALUES (?, ?, ?)`;

const SQL_DELETE_UNBLOCKED_DATE = `
    DELETE FROM re_space_unblocked_dates
     WHERE space_id = ?
       AND unblock_date = ?`;

/** Administradores do espaço com nome, login, situação e quem os adicionou. */
const SQL_LIST_SPACE_ADMINS = `
    SELECT a.user_id,
           u.name,
           u.user          AS login,
           u.ad_status,
           ${localDateTime('a.created_at', 'since')},
           a.created_by    AS added_by,
           c.name          AS added_by_name
      FROM re_space_admins a
      JOIN _user u      ON u.id = a.user_id
      LEFT JOIN _user c ON c.id = a.created_by
     WHERE a.space_id = ?
     ORDER BY u.name`;

const SQL_FIND_USER_STATUS = `
    SELECT id, ad_status
      FROM _user
     WHERE id = ?`;

/** Idempotente: adicionar de novo não muda nada (nem o autor nem a data). */
const SQL_INSERT_SPACE_ADMIN = `
    INSERT IGNORE INTO re_space_admins (space_id, user_id, created_by)
    VALUES (?, ?, ?)`;

/** A trava da remoção: sem ela, dois DELETEs simultâneos removeriam os dois últimos. */
const SQL_LOCK_SPACE = `
    SELECT id
      FROM re_spaces
     WHERE id = ?
       FOR UPDATE`;

/** Quem administra o espaço, com a situação — para decidir se sobra alguém ativo. */
const SQL_LIST_SPACE_ADMIN_STATUS = `
    SELECT a.user_id, u.ad_status
      FROM re_space_admins a
      JOIN _user u ON u.id = a.user_id
     WHERE a.space_id = ?`;

const SQL_DELETE_SPACE_ADMIN = `
    DELETE FROM re_space_admins
     WHERE space_id = ?
       AND user_id = ?`;

module.exports = {
    SQL_LIST_SPACE_ADMINS,
    SQL_FIND_USER_STATUS,
    SQL_INSERT_SPACE_ADMIN,
    SQL_LOCK_SPACE,
    SQL_LIST_SPACE_ADMIN_STATUS,
    SQL_DELETE_SPACE_ADMIN,
    SQL_LIST_SPACE_ADMIN_IDS,
    SQL_LIST_ACTIVE_SPACES,
    SQL_LIST_ALL_SPACES,
    SQL_INSERT_SPACE,
    SQL_UPDATE_SPACE,
    SQL_INSERT_SPACE_ADMINS,
    SQL_GET_SPACE_BY_ID,
    SQL_LIST_MANAGED_SPACE_IDS,
    SQL_LIST_UNBLOCKED_DATES,
    SQL_IS_DATE_UNBLOCKED,
    SQL_INSERT_UNBLOCKED_DATE,
    SQL_DELETE_UNBLOCKED_DATE,
};
