/**
 * @fileoverview Porta dos players e de tudo que pendura neles — tokens de
 * device, comandos remotos e log de status.
 *
 * Compartilhada entre a sub-feature `player` (painel) e a sub-feature `device`
 * (rotas do player Android), por isso leva o prefixo da suite.
 *
 * @module modules/global/application/meipp/ports/meipp-player-repository.port
 */

class MeippPlayerRepositoryPort {
    // ─── Players ────────────────────────────────────────────────────────────

    /** @param {object} filters @returns {Promise<{rows: object[], total: number}>} */
    list(filters) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<object|null>} */
    findById(id) { throw new Error('Not implemented'); }

    /** @param {string} uuid @returns {Promise<object|null>} */
    findByUuid(uuid) { throw new Error('Not implemented'); }

    /** @param {object} payload @returns {Promise<{id: number, uuid: string}>} */
    create(payload) { throw new Error('Not implemented'); }

    /** @param {number} id @param {object} payload @returns {Promise<void>} */
    update(id, payload) { throw new Error('Not implemented'); }

    /** Soft-delete (`active = 0`). @param {number} id @returns {Promise<void>} */
    deactivate(id) { throw new Error('Not implemented'); }

    /** @param {number} playerId @returns {Promise<number[]>} ids de grupo */
    findGroupIds(playerId) { throw new Error('Not implemented'); }

    // ─── Tokens de device ───────────────────────────────────────────────────

    /**
     * Busca o token vivo pelo hash (não revogado e não expirado).
     * @param {string} tokenHash - SHA-256 hex.
     * @returns {Promise<object|null>}
     */
    findDeviceTokenByHash(tokenHash) { throw new Error('Not implemented'); }

    /** @param {number} tokenId @returns {Promise<void>} */
    touchDeviceToken(tokenId) { throw new Error('Not implemented'); }

    /**
     * Revoga os tokens vivos do player e grava o novo, numa transação.
     * @param {number} playerId
     * @param {string} tokenHash
     * @param {Date|null} expiresAt
     * @returns {Promise<void>}
     */
    replaceDeviceToken(playerId, tokenHash, expiresAt) { throw new Error('Not implemented'); }

    /** @param {number} playerId @returns {Promise<number>} quantos foram revogados */
    revokeDeviceTokens(playerId) { throw new Error('Not implemented'); }

    // ─── Comandos remotos ───────────────────────────────────────────────────

    /** @param {object} payload @returns {Promise<number>} id do comando */
    enqueueCommand(payload) { throw new Error('Not implemented'); }

    /**
     * Lê os pendentes e marca como `sent` na mesma transação.
     * @param {number} playerId
     * @returns {Promise<object[]>}
     */
    claimPendingCommands(playerId) { throw new Error('Not implemented'); }

    /**
     * @param {number} commandId
     * @param {number} playerId
     * @param {string} status - `acknowledged` ou `failed`.
     * @returns {Promise<boolean>} `false` se o comando não era deste player.
     */
    ackCommand(commandId, playerId, status) { throw new Error('Not implemented'); }

    /** @param {number} playerId @param {object} page @returns {Promise<object[]>} */
    listCommands(playerId, page) { throw new Error('Not implemented'); }

    // ─── Heartbeat e log ────────────────────────────────────────────────────

    /**
     * Atualiza `last_seen_at`/`status`/`last_ip`/`app_version` e grava o evento
     * em `meipp_player_status_log`, na mesma transação.
     * @param {number} playerId
     * @param {object} beat - `{ ip, appVersion, eventType, detail }`
     * @returns {Promise<void>}
     */
    registerHeartbeat(playerId, beat) { throw new Error('Not implemented'); }

    /** @param {number} playerId @param {object} page @returns {Promise<{rows: object[], total: number}>} */
    listStatusLog(playerId, page) { throw new Error('Not implemented'); }
}

module.exports = { MeippPlayerRepositoryPort };
