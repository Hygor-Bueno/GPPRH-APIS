/**
 * @fileoverview Adapter MySQL de `meipp_users` (papéis do painel).
 *
 * @module modules/global/infrastructure/meipp/mysql-meipp-user.repository
 */

const { MeippUserRepositoryPort } = require('../../application/meipp/ports/meipp-user-repository.port');
const { query, execute, count } = require('./meipp-mysql.helper');
const {
    SQL_LIST_USERS,
    SQL_COUNT_USERS,
    SQL_GET_USER_BY_ID,
    SQL_GET_USER_BY_GLOBAL_ID,
    SQL_INSERT_USER,
    SQL_UPDATE_USER,
    SQL_DEACTIVATE_USER,
} = require('../../repositories/mysql/meipp-user.queries');

class MysqlMeippUserRepository extends MeippUserRepositoryPort {
    async findByGlobalUserId(globalUserId) {
        const rows = await query(SQL_GET_USER_BY_GLOBAL_ID, [globalUserId]);
        return rows[0] || null;
    }

    async findById(id) {
        const rows = await query(SQL_GET_USER_BY_ID, [id]);
        return rows[0] || null;
    }

    async list({ active, limit, offset }) {
        const [rows, total] = await Promise.all([
            query(SQL_LIST_USERS, [active, active, limit, offset]),
            count(SQL_COUNT_USERS, [active, active]),
        ]);
        return { rows, total };
    }

    async create(payload) {
        const result = await execute(SQL_INSERT_USER, [
            payload.global_user_id, payload.name, payload.email, payload.role, payload.active,
        ]);
        return result.insertId;
    }

    async update(id, payload) {
        await execute(SQL_UPDATE_USER, [
            payload.global_user_id, payload.name, payload.email, payload.role, payload.active, id,
        ]);
    }

    async deactivate(id) {
        await execute(SQL_DEACTIVATE_USER, [id]);
    }
}

module.exports = { MysqlMeippUserRepository };
