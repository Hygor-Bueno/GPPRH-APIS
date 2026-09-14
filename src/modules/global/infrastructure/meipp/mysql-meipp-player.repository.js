/**
 * @fileoverview Adapter MySQL de players, tokens de device, comandos remotos e
 * log de status.
 *
 * @module modules/global/infrastructure/meipp/mysql-meipp-player.repository
 */

const { MeippPlayerRepositoryPort } = require('../../application/meipp/ports/meipp-player-repository.port');
const { meippConfig } = require('../../../../config/meipp');
const { query, execute, count, transaction, parseJsonColumn } = require('./meipp-mysql.helper');
const {
    SQL_LIST_PLAYERS,
    SQL_COUNT_PLAYERS,
    SQL_GET_PLAYER_BY_ID,
    SQL_GET_PLAYER_BY_UUID,
    SQL_INSERT_PLAYER,
    SQL_UPDATE_PLAYER,
    SQL_DEACTIVATE_PLAYER,
    SQL_GET_PLAYER_GROUP_IDS,
    SQL_FIND_DEVICE_TOKEN,
    SQL_TOUCH_DEVICE_TOKEN,
    SQL_INSERT_DEVICE_TOKEN,
    SQL_REVOKE_PLAYER_TOKENS,
    SQL_INSERT_COMMAND,
    SQL_LIST_PENDING_COMMANDS,
    SQL_MARK_COMMANDS_SENT,
    SQL_ACK_COMMAND,
    SQL_LIST_PLAYER_COMMANDS,
    SQL_UPDATE_PLAYER_HEARTBEAT,
    SQL_INSERT_STATUS_LOG,
    SQL_LIST_STATUS_LOG,
    SQL_COUNT_STATUS_LOG,
} = require('../../repositories/mysql/meipp-player.queries');

class MysqlMeippPlayerRepository extends MeippPlayerRepositoryPort {
    /**
     * @param {object} [deps]
     * @param {number} [deps.offlineAfterMinutes] - tolerância sem heartbeat
     *   antes de a tela ser considerada offline. Injetável para teste; por
     *   padrão vem do `config/meipp`.
     */
    constructor({ offlineAfterMinutes = meippConfig.offlineAfterMinutes } = {}) {
        super();
        this.offlineAfterMinutes = offlineAfterMinutes;
    }

    // ─── Players ────────────────────────────────────────────────────────────

    async list({ active, location_id, limit, offset }) {
        const filters = [active, active, location_id, location_id];
        const [rows, total] = await Promise.all([
            // O primeiro parâmetro alimenta o CASE de `status` no SELECT.
            query(SQL_LIST_PLAYERS, [this.offlineAfterMinutes, ...filters, limit, offset]),
            count(SQL_COUNT_PLAYERS, filters),
        ]);
        return { rows, total };
    }

    async findById(id) {
        const rows = await query(SQL_GET_PLAYER_BY_ID, [this.offlineAfterMinutes, id]);
        return rows[0] || null;
    }

    async findByUuid(uuid) {
        const rows = await query(SQL_GET_PLAYER_BY_UUID, [this.offlineAfterMinutes, uuid]);
        return rows[0] || null;
    }

    async create(payload) {
        const result = await execute(SQL_INSERT_PLAYER, [
            payload.uuid, payload.name, payload.location_id, payload.hardware_type,
            payload.resolution, payload.orientation, payload.mac_address, payload.active,
        ]);
        return { id: result.insertId, uuid: payload.uuid };
    }

    async update(id, payload) {
        await execute(SQL_UPDATE_PLAYER, [
            payload.name, payload.location_id, payload.hardware_type, payload.resolution,
            payload.orientation, payload.mac_address, payload.active, id,
        ]);
    }

    async deactivate(id) {
        await execute(SQL_DEACTIVATE_PLAYER, [id]);
    }

    async findGroupIds(playerId) {
        const rows = await query(SQL_GET_PLAYER_GROUP_IDS, [playerId]);
        return rows.map((row) => Number(row.group_id));
    }

    // ─── Tokens de device ───────────────────────────────────────────────────

    async findDeviceTokenByHash(tokenHash) {
        const rows = await query(SQL_FIND_DEVICE_TOKEN, [tokenHash]);
        return rows[0] || null;
    }

    async touchDeviceToken(tokenId) {
        await execute(SQL_TOUCH_DEVICE_TOKEN, [tokenId]);
    }

    /**
     * Revogar os antigos e gravar o novo precisa ser atômico: se o INSERT
     * falhasse depois do UPDATE, a tela ficaria sem token nenhum e sem código
     * de pareamento válido — só um técnico no local resolveria.
     */
    async replaceDeviceToken(playerId, tokenHash, expiresAt) {
        await transaction(async (conn) => {
            await conn.query(SQL_REVOKE_PLAYER_TOKENS, [playerId]);
            await conn.query(SQL_INSERT_DEVICE_TOKEN, [playerId, tokenHash, expiresAt]);
        });
    }

    async revokeDeviceTokens(playerId) {
        const result = await execute(SQL_REVOKE_PLAYER_TOKENS, [playerId]);
        return Number(result.affectedRows || 0);
    }

    // ─── Comandos remotos ───────────────────────────────────────────────────

    async enqueueCommand(payload) {
        const result = await execute(SQL_INSERT_COMMAND, [
            payload.player_id,
            payload.command_type,
            payload.payload === null ? null : JSON.stringify(payload.payload),
            payload.created_by,
        ]);
        return result.insertId;
    }

    /**
     * Lê e marca como `sent` na mesma transação — sem isso, duas chamadas
     * seguidas do device (a rede do player repete com frequência) entregariam
     * o mesmo comando duas vezes, e um `reboot` duplicado derruba a tela no
     * meio da veiculação.
     */
    async claimPendingCommands(playerId) {
        return transaction(async (conn) => {
            const [rows] = await conn.query(SQL_LIST_PENDING_COMMANDS, [playerId]);
            if (rows.length > 0) {
                await conn.query(SQL_MARK_COMMANDS_SENT, [playerId]);
            }
            return rows.map((row) => ({ ...row, payload: parseJsonColumn(row.payload) }));
        });
    }

    async ackCommand(commandId, playerId, status) {
        const result = await execute(SQL_ACK_COMMAND, [status, commandId, playerId]);
        return Number(result.affectedRows || 0) > 0;
    }

    async listCommands(playerId, { limit, offset }) {
        const rows = await query(SQL_LIST_PLAYER_COMMANDS, [playerId, limit, offset]);
        return rows.map((row) => ({ ...row, payload: parseJsonColumn(row.payload) }));
    }

    // ─── Heartbeat e log ────────────────────────────────────────────────────

    /**
     * O UPDATE do player e o INSERT no log vão juntos: um sem o outro produz
     * histórico que não bate com o estado atual da tela, que é justamente o que
     * se consulta quando alguém pergunta "desde quando essa tela caiu?".
     */
    async registerHeartbeat(playerId, beat) {
        await transaction(async (conn) => {
            await conn.query(SQL_UPDATE_PLAYER_HEARTBEAT, [
                beat.ip ?? null, beat.appVersion ?? null, playerId,
            ]);
            await conn.query(SQL_INSERT_STATUS_LOG, [
                playerId,
                beat.eventType,
                beat.detail === null || beat.detail === undefined ? null : JSON.stringify(beat.detail),
            ]);
        });
    }

    async listStatusLog(playerId, { limit, offset }) {
        const [rows, total] = await Promise.all([
            query(SQL_LIST_STATUS_LOG, [playerId, limit, offset]),
            count(SQL_COUNT_STATUS_LOG, [playerId]),
        ]);
        return {
            rows: rows.map((row) => ({ ...row, detail: parseJsonColumn(row.detail) })),
            total,
        };
    }
}

module.exports = { MysqlMeippPlayerRepository };
