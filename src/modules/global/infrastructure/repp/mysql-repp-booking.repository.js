/**
 * @fileoverview Adapter MySQL de `re_bookings`.
 *
 * A trava contra reserva simultânea mora em `runLocked`: transação +
 * `SELECT ... FROM re_spaces ... FOR UPDATE` antes de qualquer checagem de
 * conflito. É o equivalente InnoDB do `UPDLOCK, HOLDLOCK` do SQL Server, e
 * trava só o espaço envolvido — reservas de espaços diferentes não esperam
 * uma pela outra.
 *
 * Travar a linha do espaço, e não um intervalo de `re_bookings`, é escolha:
 * a trava de intervalo do InnoDB (gap lock) depende do plano da consulta e,
 * com duas transações inserindo no mesmo vão, termina em deadlock em vez de
 * fila.
 *
 * @module modules/global/infrastructure/repp/mysql-repp-booking.repository
 */

const { BookingRepositoryPort } = require('../../application/repp/booking/ports/booking-repository.port');
const { query, transaction } = require('./repp-mysql.helper');
const { OCCUPYING_STATUSES } = require('../../domain/repp/repp.enums');
const {
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
} = require('../../repositories/mysql/repp-booking.queries');
const { SQL_INSERT_NOTIFICATION } = require('../../repositories/mysql/repp-notification.queries');

/** Ids chegam como número; a regra de acesso compara com `===`. */
function shape(row) {
    if (!row) return null;
    const toId = (value) => (value === null || value === undefined ? value : Number(value));
    return {
        ...row,
        id: Number(row.id),
        space_id: Number(row.space_id),
        created_by: toId(row.created_by),
        updated_by: toId(row.updated_by),
        reviewed_by: toId(row.reviewed_by),
        canceled_by: toId(row.canceled_by),
    };
}

/** Remove chaves `undefined` que `shape` cria em linha mascarada — elas não podem nem existir. */
function shapePublic(row) {
    const shaped = shape(row);
    for (const key of Object.keys(shaped)) if (shaped[key] === undefined) delete shaped[key];
    return shaped;
}

/** Operações disponíveis dentro da transação travada. */
function lockedTransaction(conn, spaces) {
    return {
        spaces,

        async findConflicts({ space_id, booking_date, start_time, end_time, exclude_id }) {
            return query(SQL_FIND_CONFLICTS, [
                space_id, booking_date, OCCUPYING_STATUSES, end_time, start_time, exclude_id,
            ], conn);
        },

        async insert(p) {
            const result = await query(SQL_INSERT_BOOKING, [
                p.space_id, p.booking_date, p.start_time, p.end_time,
                p.title, p.requester_name,
                p.company_code, p.company_name,
                p.branch_code, p.branch_name,
                p.cost_center_code, p.cost_center_description,
                p.reminder_minutes ?? null,
                p.status, p.reviewed_by, p.reviewed_by, p.created_by,
            ], conn);
            return result.insertId;
        },

        async update(id, p) {
            const reset = p.reset_review ? 1 : 0;
            const result = await query(SQL_UPDATE_BOOKING, [
                p.space_id, p.booking_date, p.start_time, p.end_time,
                p.title, p.requester_name,
                p.company_code, p.company_name,
                p.branch_code, p.branch_name,
                p.cost_center_code, p.cost_center_description,
                p.reminder_minutes ?? null, p.reset_reminder ? 1 : 0,
                p.status, reset, reset, reset,
                p.updated_by,
                id, p.expected_status,
            ], conn);
            return result.affectedRows;
        },

        async review(id, { status, reviewed_by, review_note }) {
            const result = await query(SQL_REVIEW_BOOKING, [status, reviewed_by, review_note, id], conn);
            return result.affectedRows;
        },

        async cancel(id, { canceled_by, cancel_reason }) {
            const result = await query(SQL_CANCEL_BOOKING, [canceled_by, cancel_reason, id, OCCUPYING_STATUSES], conn);
            return result.affectedRows;
        },

        async insertNotification({ user_id, booking_id, action, by_user_id, payload }) {
            const result = await query(SQL_INSERT_NOTIFICATION, [
                user_id, booking_id, action, by_user_id, JSON.stringify(payload),
            ], conn);
            return result.insertId;
        },
    };
}

class MysqlReppBookingRepository extends BookingRepositoryPort {
    async listDetailed({ start, end, spaceId, scope }) {
        // Anônimo ou logado sem espaço: nada a detalhar — nem vai ao banco.
        if (!scope.all && scope.spaceIds.length === 0 && scope.userId === null) return [];
        const { sql, params } = sqlListBookings({ detailed: true, start, end, spaceId, scope });
        const rows = await query(sql, params);
        return rows.map(shape);
    }

    async listMasked({ start, end, spaceId, scope }) {
        const { sql, params } = sqlListBookings({ detailed: false, start, end, spaceId, scope });
        const rows = await query(sql, params);
        return rows.map(shapePublic);
    }

    async listPending(scope) {
        const { sql, params } = sqlListPending(scope);
        const rows = await query(sql, params);
        return rows.map(shape);
    }

    async findAccessRow(id) {
        const rows = await query(SQL_FIND_ACCESS_ROW, [id]);
        return rows[0] ? shapePublic(rows[0]) : null;
    }

    async findDetailed(id) {
        const rows = await query(SQL_FIND_DETAILED, [id]);
        return shape(rows[0]);
    }

    async listMine({ userId, statuses, start, end, spaceId, limit, offset }) {
        const { sql, countSql, params } = sqlListMine({ statuses, start, end, spaceId });
        const [rows, counted] = await Promise.all([
            query(sql, [userId, ...params, limit, offset]),
            query(countSql, [userId, ...params]),
        ]);
        return { rows: rows.map(shape), total: Number(counted[0]?.total ?? 0) };
    }

    async runLocked(spaceIds, work) {
        const ids = [...new Set(spaceIds.map(Number))].sort((a, b) => a - b);
        return transaction(async (conn) => {
            const rows = await query(SQL_LOCK_SPACES, [ids], conn);
            const spaces = new Map(rows.map((row) => [Number(row.id), {
                id: Number(row.id),
                active: Boolean(row.active),
                setup_minutes: Number(row.setup_minutes) || 0,
            }]));
            return work(lockedTransaction(conn, spaces));
        });
    }
}

module.exports = { MysqlReppBookingRepository };
