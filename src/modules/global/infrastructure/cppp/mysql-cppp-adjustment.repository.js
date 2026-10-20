/**
 * @fileoverview Adapter MySQL dos ajustes (`cppp_punch_adjustments`).
 *
 * Traduz as linhas para o camelCase de `normalizeAdjustment`, que é o formato
 * que a visão tratada consome.
 *
 * @module modules/global/infrastructure/cppp/mysql-cppp-adjustment.repository
 */

const { CpppAdjustmentRepositoryPort } = require('../../application/cppp/ports/cppp-adjustment-repository.port');
const { query, execute, count, isDuplicate } = require('./cppp-mysql.helper');
const Q = require('../../repositories/mysql/cppp-adjustment.queries');

/** `2026-08-20T17:10:00` → `2026-08-20 17:10:00` (formato da visão tratada). */
const spaced = (value) => (value ? String(value).replace('T', ' ') : null);
const toDb = (value) => value ?? null;

function fromRow(row) {
    return {
        id: Number(row.id),
        cpf: row.cpf,
        workDate: row.work_date,
        type: row.type,
        deviceId: row.device_id === null ? null : Number(row.device_id),
        nsr: row.nsr === null ? null : Number(row.nsr),
        punchAt: spaced(row.punch_at),
        startsAt: spaced(row.starts_at),
        endsAt: spaced(row.ends_at),
        periodStart: row.period_start,
        periodEnd: row.period_end,
        reason: row.reason,
        attachmentFileId: row.attachment_file_id === null ? null : Number(row.attachment_file_id),
        createdBy: row.created_by,
        createdByName: row.created_by_name,
        createdAt: row.created_at,
        canceledAt: row.canceled_at,
        canceledBy: row.canceled_by,
        canceledByName: row.canceled_by_name,
        cancelReason: row.cancel_reason,
    };
}

class MysqlCpppAdjustmentRepository extends CpppAdjustmentRepositoryPort {
    async insert(a, createdBy) {
        try {
            const result = await execute(Q.SQL_INSERT_ADJUSTMENT, [
                a.cpf, a.workDate, a.type, toDb(a.deviceId), toDb(a.nsr), toDb(a.punchAt),
                toDb(a.startsAt), toDb(a.endsAt), toDb(a.periodStart), toDb(a.periodEnd),
                a.reason, toDb(a.attachmentFileId), createdBy,
            ]);
            return result.insertId;
        } catch (error) {
            // `uq_cppp_adj_disregard`: leitura já desconsiderada por outro
            // ajuste ativo.
            if (isDuplicate(error)) return null;
            throw error;
        }
    }

    async findById(id) {
        const rows = await query(Q.SQL_FIND_ADJUSTMENT, [id]);
        return rows.length ? fromRow(rows[0]) : null;
    }

    async cancel(id, userId, reason) {
        const result = await execute(Q.SQL_CANCEL_ADJUSTMENT, [userId, reason, id]);
        return result.affectedRows === 1;
    }

    async findActiveInRange({ from, to, cpf = null }) {
        const rows = await query(Q.SQL_FIND_ACTIVE_IN_RANGE, [cpf, cpf, from, to, to, from, from, to]);
        return rows.map(fromRow);
    }

    async findForDay(cpf, day) {
        const rows = await query(Q.SQL_FIND_FOR_DAY, [cpf, day, day, day, day, day]);
        return rows.map(fromRow);
    }

    async list({ cpf = null, from = null, to = null, type = null, includeCanceled = false, limit, offset }) {
        const filters = [cpf, cpf, type, type, includeCanceled ? 1 : 0, from, from, to, to];
        const [rows, total] = await Promise.all([
            query(Q.SQL_LIST_ADJUSTMENTS, [...filters, limit, offset]),
            count(Q.SQL_COUNT_ADJUSTMENTS, filters),
        ]);
        return { rows: rows.map(fromRow), total };
    }
}

module.exports = { MysqlCpppAdjustmentRepository, fromRow };
