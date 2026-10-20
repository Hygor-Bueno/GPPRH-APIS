/**
 * @fileoverview SQL dos ajustes de ponto (`cppp_punch_adjustments`).
 *
 * Escrita só por INSERT e pelo UPDATE de cancelamento — o banco recusa
 * qualquer outra alteração e todo DELETE por trigger.
 *
 * @module modules/global/repositories/mysql/cppp-adjustment.queries
 */

const { localDateTime } = require('./mysql-datetime.sql');

const ADJUSTMENT_COLUMNS = `
    a.id, a.cpf,
    DATE_FORMAT(a.work_date, '%Y-%m-%d') AS work_date,
    a.type, a.device_id, a.nsr,
    ${localDateTime('a.punch_at', 'punch_at')},
    ${localDateTime('a.starts_at', 'starts_at')},
    ${localDateTime('a.ends_at', 'ends_at')},
    DATE_FORMAT(a.period_start, '%Y-%m-%d') AS period_start,
    DATE_FORMAT(a.period_end, '%Y-%m-%d') AS period_end,
    a.reason, a.attachment_file_id,
    a.created_by, cu.name AS created_by_name,
    ${localDateTime('a.created_at', 'created_at')},
    ${localDateTime('a.canceled_at', 'canceled_at')},
    a.canceled_by, xu.name AS canceled_by_name,
    a.cancel_reason`;

const ADJUSTMENT_FROM = `
      FROM cppp_punch_adjustments a
      LEFT JOIN _user cu ON cu.id = a.created_by
      LEFT JOIN _user xu ON xu.id = a.canceled_by`;

const SQL_INSERT_ADJUSTMENT = `
    INSERT INTO cppp_punch_adjustments
        (cpf, work_date, type, device_id, nsr, punch_at, starts_at, ends_at,
         period_start, period_end, reason, attachment_file_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const SQL_FIND_ADJUSTMENT = `SELECT ${ADJUSTMENT_COLUMNS} ${ADJUSTMENT_FROM} WHERE a.id = ?`;

const SQL_CANCEL_ADJUSTMENT = `
    UPDATE cppp_punch_adjustments
       SET canceled_at = NOW(), canceled_by = ?, cancel_reason = ?
     WHERE id = ?
       AND canceled_at IS NULL`;

/**
 * Ajustes ATIVOS que tocam `[from, to]`: pelo dia da ocorrência, pela batida
 * esquecida ou pelo período (férias que começam antes do intervalo contam).
 */
const SQL_FIND_ACTIVE_IN_RANGE = `
    SELECT ${ADJUSTMENT_COLUMNS} ${ADJUSTMENT_FROM}
     WHERE a.canceled_at IS NULL
       AND (? IS NULL OR a.cpf = ?)
       AND (    a.work_date BETWEEN ? AND ?
             OR (a.period_start <= ? AND a.period_end >= ?)
             OR (a.punch_at >= ? AND a.punch_at < DATE_ADD(?, INTERVAL 1 DAY)))
     ORDER BY a.id`;

const SQL_FIND_FOR_DAY = `
    SELECT ${ADJUSTMENT_COLUMNS} ${ADJUSTMENT_FROM}
     WHERE a.cpf = ?
       AND (    a.work_date = ?
             OR (a.period_start <= ? AND a.period_end >= ?)
             OR (a.punch_at >= ? AND a.punch_at < DATE_ADD(?, INTERVAL 1 DAY)))
     ORDER BY a.id`;

const LIST_FILTERS = `
     WHERE (? IS NULL OR a.cpf = ?)
       AND (? IS NULL OR a.type = ?)
       AND (? = 1 OR a.canceled_at IS NULL)
       AND (? IS NULL OR COALESCE(a.period_end, a.work_date) >= ?)
       AND (? IS NULL OR COALESCE(a.period_start, a.work_date) <= ?)`;

const SQL_LIST_ADJUSTMENTS = `
    SELECT ${ADJUSTMENT_COLUMNS} ${ADJUSTMENT_FROM}
    ${LIST_FILTERS}
     ORDER BY a.id DESC
     LIMIT ? OFFSET ?`;

const SQL_COUNT_ADJUSTMENTS = `SELECT COUNT(*) AS total FROM cppp_punch_adjustments a ${LIST_FILTERS}`;

module.exports = {
    SQL_INSERT_ADJUSTMENT,
    SQL_FIND_ADJUSTMENT,
    SQL_CANCEL_ADJUSTMENT,
    SQL_FIND_ACTIVE_IN_RANGE,
    SQL_FIND_FOR_DAY,
    SQL_LIST_ADJUSTMENTS,
    SQL_COUNT_ADJUSTMENTS,
};
