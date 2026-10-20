/**
 * @fileoverview SQL do espelho do relógio (`cppp_afd_records`).
 *
 * Só leitura e o INSERT da carga. Não existe — e não deve existir — UPDATE ou
 * DELETE neste arquivo; o banco recusa os dois por trigger.
 *
 * Datas saem formatadas pelo próprio MySQL (`DATE_FORMAT`): `occurred_at` é a
 * hora de parede do relógio, e passar por `Date` do driver a deslocaria 3h
 * (ver `mysql-datetime.sql.js`).
 *
 * @module modules/global/repositories/mysql/cppp-afd.queries
 */

const { localDateTime } = require('./mysql-datetime.sql');

/**
 * Fim do primeiro bloco contínuo de NSR: o menor NSR cujo sucessor não está
 * gravado. Com o espelho sem buraco, é o maior NSR.
 */
const SQL_LAST_CONTIGUOUS_NSR = `
    SELECT a.nsr
      FROM cppp_afd_records a
      LEFT JOIN cppp_afd_records b
             ON b.device_id = a.device_id
            AND b.nsr = a.nsr + 1
     WHERE a.device_id = ?
       AND b.nsr IS NULL
     ORDER BY a.nsr
     LIMIT 1`;

const SQL_FIND_RAW_LINES = `
    SELECT nsr, raw_line
      FROM cppp_afd_records
     WHERE device_id = ?
       AND nsr BETWEEN ? AND ?`;

/** Carga em lote: `VALUES ?` com array de arrays (`pool.query`). */
const SQL_INSERT_RECORDS = `
    INSERT INTO cppp_afd_records
        (device_id, nsr, record_type, occurred_at, utc_offset, cpf, operation,
         event_code, employee_name, crc, payload, raw_line, run_id)
    VALUES ?`;

const SQL_FIND_PUNCHES = `
    SELECT device_id,
           nsr,
           cpf,
           DATE_FORMAT(occurred_at, '%Y-%m-%d') AS day,
           DATE_FORMAT(occurred_at, '%H:%i:%s') AS time
      FROM cppp_afd_records
     WHERE record_type = 3
       AND cpf IS NOT NULL
       AND occurred_at >= ?
       AND occurred_at < DATE_ADD(?, INTERVAL 1 DAY)
       AND (? IS NULL OR cpf = ?)
     ORDER BY device_id, nsr`;

const SQL_FIND_DAY_PUNCHES = `
    SELECT r.device_id,
           d.code AS device_code,
           d.name AS device_name,
           r.nsr,
           DATE_FORMAT(r.occurred_at, '%H:%i:%s') AS time,
           ${localDateTime('r.occurred_at', 'occurred_at')},
           r.utc_offset,
           r.crc
      FROM cppp_afd_records r
      JOIN cppp_devices d ON d.id = r.device_id
     WHERE r.record_type = 3
       AND r.cpf = ?
       AND r.occurred_at >= ?
       AND r.occurred_at < DATE_ADD(?, INTERVAL 1 DAY)
     ORDER BY r.device_id, r.nsr`;

const SQL_FIND_RECORD = `
    SELECT device_id,
           nsr,
           record_type,
           cpf,
           DATE_FORMAT(occurred_at, '%Y-%m-%d') AS day
      FROM cppp_afd_records
     WHERE device_id = ?
       AND nsr = ?`;

const PUNCH_FILTERS = `
     WHERE r.record_type = 3
       AND r.occurred_at >= ?
       AND r.occurred_at < DATE_ADD(?, INTERVAL 1 DAY)
       AND (? IS NULL OR r.cpf = ?)
       AND (? IS NULL OR r.device_id = ?)`;

/** Visão AFD (fiscal): a linha como o relógio gravou, em ordem de NSR. */
const SQL_LIST_PUNCHES = `
    SELECT r.device_id,
           d.code AS device_code,
           r.nsr,
           r.cpf,
           ${localDateTime('r.occurred_at', 'occurred_at')},
           r.utc_offset,
           r.crc,
           r.raw_line
      FROM cppp_afd_records r
      JOIN cppp_devices d ON d.id = r.device_id
    ${PUNCH_FILTERS}
     ORDER BY r.device_id, r.nsr
     LIMIT ? OFFSET ?`;

const SQL_COUNT_PUNCHES = `
    SELECT COUNT(*) AS total
      FROM cppp_afd_records r
    ${PUNCH_FILTERS}`;

/**
 * Chave do cadastro mais recente (tipo 5) com nome: data/hora + relógio + NSR,
 * comparável como texto. Evita uma subconsulta correlacionada por pessoa.
 */
const LATEST_REGISTRATION_KEY = `
    CONCAT(DATE_FORMAT(occurred_at, '%Y%m%d%H%i%s'), LPAD(device_id, 10, '0'), LPAD(nsr, 10, '0'))`;

const JOIN_LATEST_REGISTRATION = (alias, keyColumn) => `
    LEFT JOIN cppp_afd_records ${alias}
           ON ${alias}.device_id = CAST(SUBSTRING(${keyColumn}, 15, 10) AS UNSIGNED)
          AND ${alias}.nsr = CAST(SUBSTRING(${keyColumn}, 25, 10) AS UNSIGNED)`;

const EMPLOYEES_BASE = `
    FROM (
        SELECT cpf,
               SUM(record_type = 3) AS punches,
               MAX(CASE WHEN record_type = 3 THEN occurred_at END) AS last_punch_at,
               MAX(CASE WHEN record_type = 5 AND employee_name IS NOT NULL
                        THEN ${LATEST_REGISTRATION_KEY} END) AS registration_key
          FROM cppp_afd_records
         WHERE cpf IS NOT NULL
         GROUP BY cpf
    ) p
    ${JOIN_LATEST_REGISTRATION('n', 'p.registration_key')}
    WHERE (? = 0 OR p.punches > 0)
      AND (? IS NULL OR p.cpf LIKE ? OR n.employee_name LIKE ?)`;

/**
 * Pessoas conhecidas do relógio. O cadastro do relógio tem mais de 1.400
 * identificadores (importação em massa de 05/06/2026) e ~111 batem ponto —
 * por padrão só quem tem marcação.
 */
const SQL_LIST_EMPLOYEES = `
    SELECT p.cpf,
           p.punches,
           DATE_FORMAT(p.last_punch_at, '%Y-%m-%dT%H:%i:%s') AS last_punch_at,
           n.employee_name AS clock_name,
           n.operation AS clock_last_operation
    ${EMPLOYEES_BASE}
     ORDER BY n.employee_name IS NULL, n.employee_name, p.cpf
     LIMIT ? OFFSET ?`;

const SQL_COUNT_EMPLOYEES = `SELECT COUNT(*) AS total ${EMPLOYEES_BASE}`;

const SQL_CLOCK_NAMES = `
    SELECT x.cpf, n.employee_name, n.operation
      FROM (
            SELECT cpf, MAX(${LATEST_REGISTRATION_KEY}) AS registration_key
              FROM cppp_afd_records
             WHERE record_type = 5
               AND employee_name IS NOT NULL
               AND cpf IN (?)
             GROUP BY cpf
           ) x
    ${JOIN_LATEST_REGISTRATION('n', 'x.registration_key')}`;

module.exports = {
    SQL_LAST_CONTIGUOUS_NSR,
    SQL_FIND_RAW_LINES,
    SQL_INSERT_RECORDS,
    SQL_FIND_PUNCHES,
    SQL_FIND_DAY_PUNCHES,
    SQL_FIND_RECORD,
    SQL_LIST_PUNCHES,
    SQL_COUNT_PUNCHES,
    SQL_LIST_EMPLOYEES,
    SQL_COUNT_EMPLOYEES,
    SQL_CLOCK_NAMES,
};
