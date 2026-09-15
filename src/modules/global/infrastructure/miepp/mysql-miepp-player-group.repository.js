/**
 * @fileoverview Adapter MySQL de `miepp_player_groups` e seus membros.
 *
 * @module modules/global/infrastructure/miepp/mysql-miepp-player-group.repository
 */

const { PlayerGroupRepositoryPort } = require('../../application/miepp/player-group/ports/player-group-repository.port');
const { mieppConfig } = require('../../../../config/miepp');
const { query, execute, count } = require('./miepp-mysql.helper');
const {
    SQL_LIST_GROUPS,
    SQL_COUNT_GROUPS,
    SQL_GET_GROUP_BY_ID,
    SQL_GET_GROUP_MEMBERS,
    SQL_INSERT_GROUP,
    SQL_UPDATE_GROUP,
    SQL_DELETE_GROUP,
    SQL_ADD_GROUP_MEMBER,
    SQL_REMOVE_GROUP_MEMBER,
} = require('../../repositories/mysql/miepp-player-group.queries');

class MysqlMieppPlayerGroupRepository extends PlayerGroupRepositoryPort {
    async list({ limit, offset }) {
        const [rows, total] = await Promise.all([
            query(SQL_LIST_GROUPS, [limit, offset]),
            count(SQL_COUNT_GROUPS),
        ]);
        return { rows, total };
    }

    async findById(id) {
        const rows = await query(SQL_GET_GROUP_BY_ID, [id]);
        return rows[0] || null;
    }

    async findMembers(id) {
        // O primeiro parâmetro alimenta o CASE de `status` no SELECT.
        return query(SQL_GET_GROUP_MEMBERS, [mieppConfig.offlineAfterMinutes, id]);
    }

    async create(payload) {
        const result = await execute(SQL_INSERT_GROUP, [payload.name, payload.description]);
        return result.insertId;
    }

    async update(id, payload) {
        await execute(SQL_UPDATE_GROUP, [payload.name, payload.description, id]);
    }

    async remove(id) {
        await execute(SQL_DELETE_GROUP, [id]);
    }

    async addMember(groupId, playerId) {
        await execute(SQL_ADD_GROUP_MEMBER, [playerId, groupId]);
    }

    async removeMember(groupId, playerId) {
        const result = await execute(SQL_REMOVE_GROUP_MEMBER, [playerId, groupId]);
        return Number(result.affectedRows || 0) > 0;
    }
}

module.exports = { MysqlMieppPlayerGroupRepository };
