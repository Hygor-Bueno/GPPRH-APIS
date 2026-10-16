/**
 * @fileoverview Adapter MySQL de `re_spaces` + `re_space_admins` +
 * `re_space_unblocked_dates`. A remoção de administrador trava a linha do
 * espaço (`FOR UPDATE`), como a reserva: duas remoções simultâneas dos dois
 * últimos administradores entram em fila, e a segunda vê a primeira.
 *
 * @module modules/global/infrastructure/repp/mysql-repp-space.repository
 */

const { ReppSpaceRepositoryPort } = require('../../application/repp/ports/repp-space-repository.port');
const { query, transaction } = require('./repp-mysql.helper');
const { parseWeekdays } = require('../../domain/repp/booking-window.rules');
const {
    SQL_LIST_ACTIVE_SPACES,
    SQL_GET_SPACE_BY_ID,
    SQL_LIST_MANAGED_SPACE_IDS,
    SQL_LIST_SPACE_ADMIN_IDS,
    SQL_LIST_UNBLOCKED_DATES,
    SQL_IS_DATE_UNBLOCKED,
    SQL_INSERT_UNBLOCKED_DATE,
    SQL_DELETE_UNBLOCKED_DATE,
    SQL_LIST_SPACE_ADMINS,
    SQL_FIND_USER_STATUS,
    SQL_INSERT_SPACE_ADMIN,
    SQL_LOCK_SPACE,
    SQL_LIST_SPACE_ADMIN_STATUS,
    SQL_DELETE_SPACE_ADMIN,
} = require('../../repositories/mysql/repp-space.queries');

const toId = (value) => (value === null || value === undefined ? null : Number(value));

/** TINYINT chega como número; o caso de uso compara com booleano. `'2,4'` vira `[2, 4]`. */
function shape(row) {
    if (!row) return null;
    return {
        id: Number(row.id),
        name: row.name,
        description: row.description,
        blocked_weekdays: parseWeekdays(row.blocked_weekdays),
        setup_minutes: Number(row.setup_minutes) || 0,
        active: Boolean(row.active),
    };
}

class MysqlReppSpaceRepository extends ReppSpaceRepositoryPort {
    async listActive() {
        const rows = await query(SQL_LIST_ACTIVE_SPACES);
        return rows.map(shape);
    }

    async findById(id) {
        const rows = await query(SQL_GET_SPACE_BY_ID, [id]);
        return shape(rows[0]);
    }

    async findManagedSpaceIds(userId) {
        const rows = await query(SQL_LIST_MANAGED_SPACE_IDS, [userId]);
        return rows.map((row) => Number(row.space_id));
    }

    async findAdminIds(spaceId) {
        const rows = await query(SQL_LIST_SPACE_ADMIN_IDS, [spaceId]);
        return rows.map((row) => Number(row.user_id));
    }

    async listUnblockedDates(spaceIds, fromDate) {
        const result = new Map(spaceIds.map((id) => [Number(id), []]));
        if (!spaceIds.length) return result;
        const rows = await query(SQL_LIST_UNBLOCKED_DATES, [spaceIds, fromDate]);
        for (const row of rows) result.get(Number(row.space_id))?.push(row.unblock_date);
        return result;
    }

    async isDateUnblocked(spaceId, date) {
        const rows = await query(SQL_IS_DATE_UNBLOCKED, [spaceId, date]);
        return rows.length > 0;
    }

    async addUnblockedDate(spaceId, date, userId) {
        await query(SQL_INSERT_UNBLOCKED_DATE, [spaceId, date, userId]);
    }

    async removeUnblockedDate(spaceId, date) {
        await query(SQL_DELETE_UNBLOCKED_DATE, [spaceId, date]);
    }

    async listAdmins(spaceId) {
        const rows = await query(SQL_LIST_SPACE_ADMINS, [spaceId]);
        return rows.map((row) => ({
            user_id: Number(row.user_id),
            name: row.name,
            login: row.login,
            ad_status: row.ad_status,
            since: row.since,
            added_by: toId(row.added_by),
            added_by_name: row.added_by_name ?? null,
        }));
    }

    async findUserStatus(userId) {
        const rows = await query(SQL_FIND_USER_STATUS, [userId]);
        return rows[0] ? { id: Number(rows[0].id), ad_status: rows[0].ad_status } : null;
    }

    async addAdmin(spaceId, userId, createdBy) {
        await query(SQL_INSERT_SPACE_ADMIN, [spaceId, userId, createdBy]);
    }

    /**
     * Trava a linha do espaço, lê os administradores, deixa `assertRemovable`
     * recusar (lançando) e só então apaga — tudo na mesma transação.
     */
    async removeAdmin(spaceId, userId, assertRemovable) {
        return transaction(async (conn) => {
            await query(SQL_LOCK_SPACE, [spaceId], conn);
            const admins = await query(SQL_LIST_SPACE_ADMIN_STATUS, [spaceId], conn);
            assertRemovable(admins.map((row) => ({ user_id: Number(row.user_id), ad_status: row.ad_status })));
            const result = await query(SQL_DELETE_SPACE_ADMIN, [spaceId, userId], conn);
            return result.affectedRows;
        });
    }
}

module.exports = { MysqlReppSpaceRepository };
