/**
 * @fileoverview SQL dos relógios (`cppp_devices`) e das coletas
 * (`cppp_collect_runs`).
 *
 * Os carimbos de tempo das coletas são `NOW()` do MySQL (servidor em -03) e
 * saem pelo `localDateTime()` — sem fuso, lidos como hora local pela tela.
 *
 * @module modules/global/repositories/mysql/cppp-collect.queries
 */

const { localDateTime } = require('./mysql-datetime.sql');

// ─── Relógios ────────────────────────────────────────────────────────────────

// `base_url` sai para a tela: o IP é cadastrado e editado por ela (cada relógio
// tem o seu). A senha não está em coluna nenhuma.
const DEVICE_COLUMNS = `
    d.id, d.code, d.name, d.base_url, d.rep_number, d.active,
    ${localDateTime('d.created_at', 'created_at')},
    ${localDateTime('d.updated_at', 'updated_at')},
    d.updated_by, uu.name AS updated_by_name`;

const DEVICE_FROM = `
      FROM cppp_devices d
      LEFT JOIN _user uu ON uu.id = d.updated_by`;

const SQL_LIST_ACTIVE_DEVICES = `
    SELECT ${DEVICE_COLUMNS} ${DEVICE_FROM}
     WHERE d.active = 1
     ORDER BY d.id`;

const SQL_FIND_DEVICE = `SELECT ${DEVICE_COLUMNS} ${DEVICE_FROM} WHERE d.id = ?`;

const SQL_FIND_DEVICE_BY_REP = `SELECT ${DEVICE_COLUMNS} ${DEVICE_FROM} WHERE d.rep_number = ?`;

const SQL_INSERT_DEVICE = `
    INSERT INTO cppp_devices (code, name, base_url, rep_number, active, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`;

/** Colunas que o PUT pode tocar → nome no banco. `code` fica de fora: não muda. */
const DEVICE_UPDATABLE = Object.freeze({
    name: 'name',
    baseUrl: 'base_url',
    repNumber: 'rep_number',
    active: 'active',
});

const SQL_DEVICE_HAS_RECORDS = `
    SELECT EXISTS (SELECT 1 FROM cppp_afd_records WHERE device_id = ?) AS has_records`;

const SQL_SET_REP_IF_EMPTY = `
    UPDATE cppp_devices SET rep_number = ? WHERE id = ? AND rep_number IS NULL`;

const SQL_LIST_DEVICES_WITH_LAST_RUN = `
    SELECT ${DEVICE_COLUMNS},
           lr.id     AS last_run_id,
           lr.status AS last_run_status,
           lr.trigger_source AS last_run_trigger,
           ${localDateTime('lr.created_at', 'last_run_created_at')},
           ${localDateTime('lr.finished_at', 'last_run_finished_at')},
           lr.error    AS last_run_error,
           lr.warnings AS last_run_warnings,
           ${localDateTime('ls.started_at', 'last_success_at')},
           (SELECT MAX(r.nsr) FROM cppp_afd_records r WHERE r.device_id = d.id) AS last_nsr
    ${DEVICE_FROM}
      LEFT JOIN cppp_collect_runs lr
             ON lr.id = (SELECT MAX(id) FROM cppp_collect_runs WHERE device_id = d.id)
      LEFT JOIN cppp_collect_runs ls
             ON ls.id = (SELECT MAX(id) FROM cppp_collect_runs WHERE device_id = d.id AND status = 'success')
     ORDER BY d.name`;

// ─── Coletas ─────────────────────────────────────────────────────────────────

const RUN_COLUMNS = `
    r.id, r.device_id, d.code AS device_code, d.name AS device_name,
    r.trigger_source, r.requested_by, u.name AS requested_by_name,
    r.requested_from, r.status,
    ${localDateTime('r.created_at', 'created_at')},
    ${localDateTime('r.started_at', 'started_at')},
    ${localDateTime('r.finished_at', 'finished_at')},
    r.extracted_count, r.inserted_count, r.identical_count, r.rejected_count, r.conflict_count,
    r.first_nsr, r.last_nsr, r.trailer_check,
    r.raw_file_path, r.raw_sha256, r.raw_bytes,
    r.error, r.warnings`;

const RUN_FROM = `
      FROM cppp_collect_runs r
      JOIN cppp_devices d ON d.id = r.device_id
      LEFT JOIN _user u ON u.id = r.requested_by`;

const SQL_ENQUEUE_RUN = `
    INSERT INTO cppp_collect_runs (device_id, trigger_source, requested_by)
    VALUES (?, ?, ?)`;

const SQL_FIND_RUN = `SELECT ${RUN_COLUMNS} ${RUN_FROM} WHERE r.id = ?`;

const SQL_FIND_ACTIVE_RUN = `
    SELECT ${RUN_COLUMNS} ${RUN_FROM}
     WHERE r.device_id = ?
       AND r.status IN ('queued', 'running')
     LIMIT 1`;

const RUN_FILTERS = `
     WHERE (? IS NULL OR r.device_id = ?)
       AND (? IS NULL OR r.status = ?)`;

const SQL_LIST_RUNS = `
    SELECT ${RUN_COLUMNS} ${RUN_FROM}
    ${RUN_FILTERS}
     ORDER BY r.id DESC
     LIMIT ? OFFSET ?`;

const SQL_COUNT_RUNS = `SELECT COUNT(*) AS total FROM cppp_collect_runs r ${RUN_FILTERS}`;

const SQL_NEXT_QUEUED_RUN = `
    SELECT ${RUN_COLUMNS} ${RUN_FROM}
     WHERE r.status = 'queued'
     ORDER BY r.id
     LIMIT 1`;

/** Só vira `running` quem ainda está `queued` — `affectedRows` diz quem ganhou. */
const SQL_CLAIM_RUN = `
    UPDATE cppp_collect_runs
       SET status = 'running', started_at = NOW()
     WHERE id = ?
       AND status = 'queued'`;

const SQL_SET_REQUESTED_FROM = `
    UPDATE cppp_collect_runs SET requested_from = ? WHERE id = ?`;

const SQL_FINISH_RUN = `
    UPDATE cppp_collect_runs
       SET status = ?,
           finished_at = NOW(),
           extracted_count = ?,
           inserted_count = ?,
           identical_count = ?,
           rejected_count = ?,
           conflict_count = ?,
           first_nsr = ?,
           last_nsr = ?,
           trailer_check = ?,
           raw_file_path = ?,
           raw_sha256 = ?,
           raw_bytes = ?,
           error = ?,
           warnings = ?
     WHERE id = ?`;

const SQL_FAIL_STUCK_RUNS = `
    UPDATE cppp_collect_runs
       SET status = 'failed',
           finished_at = NOW(),
           error = 'Interrompida: o worker parou no meio da coleta. O que já tinha sido gravado continua no espelho; a próxima coleta recomeça do primeiro NSR que faltar.'
     WHERE status = 'running'
       AND started_at < NOW() - INTERVAL ? MINUTE`;

const SQL_LAST_SCHEDULED_AT = `
    SELECT DATE_FORMAT(MAX(created_at), '%Y-%m-%dT%H:%i:%s') AS at
      FROM cppp_collect_runs
     WHERE device_id = ?
       AND trigger_source = 'schedule'`;

/**
 * `started_at`, e não `finished_at`: o AFD é baixado DEPOIS do início. Uma
 * coleta que começa 23:59:50 e termina 00:00:30 não cobre o fim daquele dia,
 * e contar pelo término diria que cobre.
 */
const SQL_LAST_SUCCESS_BY_DEVICE = `
    SELECT d.id AS device_id,
           DATE_FORMAT(MAX(r.started_at), '%Y-%m-%dT%H:%i:%s') AS last_success_at
      FROM cppp_devices d
      LEFT JOIN cppp_collect_runs r
             ON r.device_id = d.id
            AND r.status = 'success'
     WHERE d.active = 1
     GROUP BY d.id`;

/**
 * UPDATE parcial do relógio. Só nomes de coluna de `DEVICE_UPDATABLE` entram
 * no texto; valores vão sempre como parâmetro.
 *
 * @param {string[]} fields - chaves camelCase presentes no pedido.
 * @returns {string}
 */
function sqlUpdateDevice(fields) {
    const sets = fields.map((field) => {
        const column = DEVICE_UPDATABLE[field];
        if (!column) throw new Error(`Campo de relógio não atualizável: ${field}`);
        return `${column} = ?`;
    });
    return `UPDATE cppp_devices SET ${[...sets, 'updated_by = ?'].join(', ')} WHERE id = ?`;
}

module.exports = {
    SQL_LIST_ACTIVE_DEVICES,
    SQL_FIND_DEVICE,
    SQL_FIND_DEVICE_BY_REP,
    SQL_INSERT_DEVICE,
    DEVICE_UPDATABLE,
    sqlUpdateDevice,
    SQL_DEVICE_HAS_RECORDS,
    SQL_SET_REP_IF_EMPTY,
    SQL_LIST_DEVICES_WITH_LAST_RUN,
    SQL_ENQUEUE_RUN,
    SQL_FIND_RUN,
    SQL_FIND_ACTIVE_RUN,
    SQL_LIST_RUNS,
    SQL_COUNT_RUNS,
    SQL_NEXT_QUEUED_RUN,
    SQL_CLAIM_RUN,
    SQL_SET_REQUESTED_FROM,
    SQL_FINISH_RUN,
    SQL_FAIL_STUCK_RUNS,
    SQL_LAST_SCHEDULED_AT,
    SQL_LAST_SUCCESS_BY_DEVICE,
};
