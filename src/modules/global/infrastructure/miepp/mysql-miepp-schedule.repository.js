/**
 * @fileoverview Adapter MySQL de `miepp_schedules` e `miepp_schedule_targets`.
 *
 * @module modules/global/infrastructure/miepp/mysql-miepp-schedule.repository
 */

const { MieppScheduleRepositoryPort } = require('../../application/miepp/ports/miepp-schedule-repository.port');
const { TargetType } = require('../../domain/miepp/miepp.enums');
const { query, execute, count } = require('./miepp-mysql.helper');
const {
    SQL_LIST_SCHEDULES,
    SQL_COUNT_SCHEDULES,
    SQL_GET_SCHEDULE_BY_ID,
    SQL_GET_ACTIVE_SCHEDULES,
    SQL_GET_ACTIVE_SCHEDULE_TARGETS,
    SQL_INSERT_SCHEDULE,
    SQL_UPDATE_SCHEDULE,
    SQL_DELETE_SCHEDULE,
    SQL_GET_SCHEDULE_TARGETS,
    SQL_INSERT_SCHEDULE_TARGET,
    SQL_DELETE_SCHEDULE_TARGET,
    SQL_PLAYER_EXISTS,
    SQL_GROUP_EXISTS,
} = require('../../repositories/mysql/miepp-schedule.queries');

/**
 * Agrupa as linhas de alvo por agendamento.
 *
 * @param {Array<{schedule_id: number, target_type: string, target_id: number|null}>} rows
 * @returns {Map<number, Array<{target_type: string, target_id: number|null}>>}
 */
function groupTargetsByScheduleId(rows) {
    const byScheduleId = new Map();

    for (const row of rows) {
        const scheduleId = Number(row.schedule_id);
        const targets = byScheduleId.get(scheduleId) || [];

        targets.push({
            target_type: row.target_type,
            target_id: row.target_id === null ? null : Number(row.target_id),
        });

        byScheduleId.set(scheduleId, targets);
    }

    return byScheduleId;
}

class MysqlMieppScheduleRepository extends MieppScheduleRepositoryPort {
    async list({ active, limit, offset }) {
        const [rows, total] = await Promise.all([
            query(SQL_LIST_SCHEDULES, [active, active, limit, offset]),
            count(SQL_COUNT_SCHEDULES, [active, active]),
        ]);
        return { rows, total };
    }

    async findById(id) {
        const rows = await query(SQL_GET_SCHEDULE_BY_ID, [id]);
        return rows[0] || null;
    }

    /**
     * Agendamentos ativos com os alvos embutidos.
     *
     * Duas consultas em paralelo em vez de um join agregado — ver o porquê em
     * `SQL_GET_ACTIVE_SCHEDULE_TARGETS`. Agendamento sem alvo nenhum fica com
     * `targets: []` e o resolvedor não o casa com ninguém, que é o correto.
     */
    async findActiveWithTargets() {
        const [schedules, targetRows] = await Promise.all([
            query(SQL_GET_ACTIVE_SCHEDULES),
            query(SQL_GET_ACTIVE_SCHEDULE_TARGETS),
        ]);

        const targetsByScheduleId = groupTargetsByScheduleId(targetRows);

        return schedules.map((schedule) => ({
            ...schedule,
            targets: targetsByScheduleId.get(Number(schedule.id)) || [],
        }));
    }

    async create(payload) {
        const result = await execute(SQL_INSERT_SCHEDULE, [
            payload.name, payload.playlist_id, payload.priority,
            payload.start_date, payload.end_date, payload.start_time, payload.end_time,
            payload.days_of_week, payload.active, payload.created_by,
        ]);
        return result.insertId;
    }

    async update(id, payload) {
        await execute(SQL_UPDATE_SCHEDULE, [
            payload.name, payload.playlist_id, payload.priority,
            payload.start_date, payload.end_date, payload.start_time, payload.end_time,
            payload.days_of_week, payload.active, id,
        ]);
    }

    async remove(id) {
        await execute(SQL_DELETE_SCHEDULE, [id]);
    }

    async findTargets(scheduleId) {
        return query(SQL_GET_SCHEDULE_TARGETS, [scheduleId]);
    }

    async addTarget(scheduleId, target) {
        const result = await execute(SQL_INSERT_SCHEDULE_TARGET, [
            scheduleId, target.target_type, target.target_id,
        ]);
        return result.insertId;
    }

    async removeTarget(scheduleId, targetId) {
        const result = await execute(SQL_DELETE_SCHEDULE_TARGET, [targetId, scheduleId]);
        return Number(result.affectedRows || 0) > 0;
    }

    async targetExists(targetType, targetId) {
        if (targetType === TargetType.PLAYER) {
            const rows = await query(SQL_PLAYER_EXISTS, [targetId]);
            return rows.length > 0;
        }

        if (targetType === TargetType.GROUP) {
            const rows = await query(SQL_GROUP_EXISTS, [targetId]);
            return rows.length > 0;
        }

        return false;
    }
}

module.exports = { MysqlMieppScheduleRepository, groupTargetsByScheduleId };
