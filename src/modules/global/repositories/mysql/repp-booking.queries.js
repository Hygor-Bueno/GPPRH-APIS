/**
 * @fileoverview SQL de `re_bookings` (REPP).
 *
 * ─── Duas projeções, de propósito ───────────────────────────────────────────
 * `PUBLIC_COLUMNS` é tudo o que a agenda pública pode ler. A consulta
 * mascarada usa SÓ ela — título, solicitante, empresa, filial, centro de custo
 * e autoria nem saem do banco para quem não pode vê-los.
 *
 * ─── Datas ──────────────────────────────────────────────────────────────────
 * DATE e TIME saem como texto (`2026-10-08`, `09:30`): são hora local de
 * parede, e passar por `Date` no driver as deslocaria pelo fuso. TIMESTAMP e
 * DATETIME saem por `localDateTime()` — ver `mysql-datetime.sql.js`.
 *
 * @module modules/global/repositories/mysql/repp-booking.queries
 */

const { localDateTime } = require('./mysql-datetime.sql');
const { OCCUPYING_STATUSES, BookingStatus } = require('../../domain/repp/repp.enums');

/**
 * Usuário que não existe, para o escopo de detalhes de quem é anônimo.
 * `_user.id` é AUTO_INCREMENT positivo; `created_by` nulo (usuário apagado)
 * nunca casa com ele — e é por isso que não se usa NULL aqui: com `<=>`,
 * NULL casaria com toda reserva sem autor e a mostraria detalhada a anônimo.
 */
const NO_USER = -1;

/** Espaço que não existe, para `IN (?)` nunca receber lista vazia. */
const NO_SPACE = 0;

const PUBLIC_COLUMNS = `
        b.id,
        b.space_id,
        s.name AS space_name,
        DATE_FORMAT(b.booking_date, '%Y-%m-%d') AS booking_date,
        TIME_FORMAT(b.start_time, '%H:%i')      AS start_time,
        TIME_FORMAT(b.end_time, '%H:%i')        AS end_time,
        b.status`;

const DETAIL_COLUMNS = `${PUBLIC_COLUMNS},
        b.title,
        b.requester_name,
        b.company_code,
        b.company_name,
        b.branch_code,
        b.branch_name,
        b.cost_center_code,
        b.cost_center_description,
        b.created_by,
        TRIM(uc.name) AS created_by_name,
        ${localDateTime('b.created_at')},
        b.updated_by,
        TRIM(uu.name) AS updated_by_name,
        ${localDateTime('b.updated_at')},
        b.reviewed_by,
        TRIM(ur.name) AS reviewed_by_name,
        ${localDateTime('b.reviewed_at')},
        b.review_note,
        b.canceled_by,
        TRIM(ux.name) AS canceled_by_name,
        ${localDateTime('b.canceled_at')},
        b.cancel_reason`;

const PUBLIC_FROM = `
      FROM re_bookings b
      JOIN re_spaces   s  ON s.id  = b.space_id`;

const DETAIL_FROM = `${PUBLIC_FROM}
      LEFT JOIN _user  uc ON uc.id = b.created_by
      LEFT JOIN _user  uu ON uu.id = b.updated_by
      LEFT JOIN _user  ur ON ur.id = b.reviewed_by
      LEFT JOIN _user  ux ON ux.id = b.canceled_by`;

const ORDER_AGENDA = 'ORDER BY b.booking_date, b.start_time, b.space_id';

/**
 * Agenda do intervalo, pendentes e aprovadas, numa das duas metades.
 *
 * Detalhada: `space_id IN (administrados) OR created_by = usuário` (dono: sem
 * recorte). Mascarada: o complemento exato — `NOT IN` e `NOT (<=>)`, que
 * nunca dão NULL, então nenhuma reserva cai entre as duas metades.
 *
 * @param {{detailed: boolean, start: string, end: string, spaceId: ?number,
 *          scope: {all: boolean, spaceIds: number[], userId: ?number}}} filter
 * @returns {{sql: string, params: Array}}
 */
function sqlListBookings({ detailed, start, end, spaceId, scope }) {
    const params = [start, end, OCCUPYING_STATUSES];
    let where = 'b.booking_date BETWEEN ? AND ? AND b.status IN (?)';

    if (spaceId) {
        where += ' AND b.space_id = ?';
        params.push(spaceId);
    }

    const spaceIds = scope.spaceIds.length ? scope.spaceIds : [NO_SPACE];
    const userId = scope.userId ?? NO_USER;

    if (detailed && !scope.all) {
        where += ' AND (b.space_id IN (?) OR b.created_by = ?)';
        params.push(spaceIds, userId);
    } else if (!detailed) {
        where += ' AND b.space_id NOT IN (?) AND NOT (b.created_by <=> ?)';
        params.push(spaceIds, userId);
    }

    return {
        sql: `SELECT ${detailed ? DETAIL_COLUMNS : PUBLIC_COLUMNS}
                ${detailed ? DETAIL_FROM : PUBLIC_FROM}
               WHERE ${where}
               ${ORDER_AGENDA}`,
        params,
    };
}

/**
 * Fila de aprovação: pendentes de hoje em diante (o caso de uso tira as que
 * já começaram hoje).
 *
 * @param {{all: boolean, spaceIds: number[]}} scope
 */
function sqlListPending({ all, spaceIds }) {
    const params = [BookingStatus.Pending];
    let where = 'b.status = ? AND b.booking_date >= CURDATE()';
    if (!all) {
        where += ' AND b.space_id IN (?)';
        params.push(spaceIds.length ? spaceIds : [NO_SPACE]);
    }
    return {
        sql: `SELECT ${DETAIL_COLUMNS} ${DETAIL_FROM} WHERE ${where} ${ORDER_AGENDA}`,
        params,
    };
}

/**
 * "Minhas reservas": criadas pelo usuário, qualquer status, mais recentes
 * primeiro. Filtros opcionais montados só quando vêm.
 *
 * @param {{statuses: ?string[], start: ?string, end: ?string, spaceId: ?number}} filter
 * @returns {{sql: string, countSql: string, params: Array}}
 *   `params` serve às duas; a listagem recebe ainda `LIMIT ? OFFSET ?`.
 */
function sqlListMine({ statuses, start, end, spaceId }) {
    const params = [];
    const conditions = ['b.created_by = ?'];
    if (statuses) { conditions.push('b.status IN (?)'); params.push(statuses); }
    if (start) { conditions.push('b.booking_date >= ?'); params.push(start); }
    if (end) { conditions.push('b.booking_date <= ?'); params.push(end); }
    if (spaceId) { conditions.push('b.space_id = ?'); params.push(spaceId); }
    const where = conditions.join(' AND ');
    return {
        sql: `SELECT ${DETAIL_COLUMNS} ${DETAIL_FROM} WHERE ${where}
              ORDER BY b.booking_date DESC, b.start_time DESC, b.id DESC
              LIMIT ? OFFSET ?`,
        countSql: `SELECT COUNT(*) AS total FROM re_bookings b WHERE ${where}`,
        params,
    };
}

/** Campos públicos + `created_by`, que decide acesso e NÃO sai na versão mascarada. */
const SQL_FIND_ACCESS_ROW = `
    SELECT ${PUBLIC_COLUMNS},
           b.created_by
      ${PUBLIC_FROM}
     WHERE b.id = ?`;

const SQL_FIND_DETAILED = `
    SELECT ${DETAIL_COLUMNS}
      ${DETAIL_FROM}
     WHERE b.id = ?`;

/**
 * A trava. Em ordem de id, para que duas transações que travam os mesmos dois
 * espaços (edição que troca de espaço) peguem as linhas na mesma ordem e não
 * se esperem em ciclo.
 */
const SQL_LOCK_SPACES = `
    SELECT id, active, setup_minutes
      FROM re_spaces
     WHERE id IN (?)
     ORDER BY id
       FOR UPDATE`;

/**
 * Reservas vivas que cruzam `[início, fim)` no mesmo espaço e dia — todas,
 * por início: a janela já vem alargada pela folga de organização, e o caso de
 * uso escolhe qual explica a recusa (sobreposição antes de folga). São
 * poucas: um dia de um espaço.
 * Encostar não é conflito (`start < fim_outra AND fim > início_outra`).
 * `exclude_id` = a própria reserva numa edição/aprovação (0 numa criação).
 */
const SQL_FIND_CONFLICTS = `
    SELECT id,
           TIME_FORMAT(start_time, '%H:%i') AS start_time,
           TIME_FORMAT(end_time, '%H:%i')   AS end_time
      FROM re_bookings
     WHERE space_id     = ?
       AND booking_date = ?
       AND status IN (?)
       AND start_time   < ?
       AND end_time     > ?
       AND id          <> ?
     ORDER BY start_time`;

/** `reviewed_at` só é carimbado quando há aprovação automática (`reviewed_by` preenchido). */
const SQL_INSERT_BOOKING = `
    INSERT INTO re_bookings (
        space_id, booking_date, start_time, end_time,
        title, requester_name,
        company_code, company_name,
        branch_code, branch_name,
        cost_center_code, cost_center_description,
        status, reviewed_by, reviewed_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, IF(? IS NULL, NULL, NOW()), ?)`;

/**
 * Edição. `WHERE status = ?` com o status lido antes: se alguém aprovou,
 * recusou ou cancelou no meio, nada é gravado (0 linhas → 409 no caso de uso).
 * `reset_review` limpa a decisão anterior quando a reserva volta para a fila.
 */
const SQL_UPDATE_BOOKING = `
    UPDATE re_bookings
       SET space_id                = ?,
           booking_date            = ?,
           start_time              = ?,
           end_time                = ?,
           title                   = ?,
           requester_name          = ?,
           company_code            = ?,
           company_name            = ?,
           branch_code             = ?,
           branch_name             = ?,
           cost_center_code        = ?,
           cost_center_description = ?,
           status                  = ?,
           reviewed_by             = IF(?, NULL, reviewed_by),
           reviewed_at             = IF(?, NULL, reviewed_at),
           review_note             = IF(?, NULL, review_note),
           updated_by              = ?
     WHERE id = ?
       AND status = ?`;

const SQL_CANCEL_BOOKING = `
    UPDATE re_bookings
       SET status        = '${BookingStatus.Canceled}',
           canceled_by   = ?,
           canceled_at   = NOW(),
           cancel_reason = ?
     WHERE id = ?
       AND status IN (?)`;

const SQL_REVIEW_BOOKING = `
    UPDATE re_bookings
       SET status      = ?,
           reviewed_by = ?,
           reviewed_at = NOW(),
           review_note = ?
     WHERE id = ?
       AND status = '${BookingStatus.Pending}'`;

module.exports = {
    NO_USER,
    NO_SPACE,
    sqlListBookings,
    sqlListPending,
    sqlListMine,
    SQL_FIND_ACCESS_ROW,
    SQL_FIND_DETAILED,
    SQL_LOCK_SPACES,
    SQL_FIND_CONFLICTS,
    SQL_INSERT_BOOKING,
    SQL_UPDATE_BOOKING,
    SQL_CANCEL_BOOKING,
    SQL_REVIEW_BOOKING,
};
