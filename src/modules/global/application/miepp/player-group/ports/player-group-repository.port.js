/**
 * @fileoverview Porta de `miepp_player_groups` e seus membros.
 *
 * Usada só pela sub-feature `player-group` — sem prefixo de suite.
 *
 * @module modules/global/application/miepp/player-group/ports/player-group-repository.port
 */

class PlayerGroupRepositoryPort {
    /** @param {object} filters @returns {Promise<{rows: object[], total: number}>} */
    list(filters) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<object|null>} */
    findById(id) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<object[]>} */
    findMembers(id) { throw new Error('Not implemented'); }

    /** @param {object} payload @returns {Promise<number>} */
    create(payload) { throw new Error('Not implemented'); }

    /** @param {number} id @param {object} payload @returns {Promise<void>} */
    update(id, payload) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<void>} */
    remove(id) { throw new Error('Not implemented'); }

    /** Idempotente — repetir não é erro. @returns {Promise<void>} */
    addMember(groupId, playerId) { throw new Error('Not implemented'); }

    /** @returns {Promise<boolean>} `false` se o vínculo não existia. */
    removeMember(groupId, playerId) { throw new Error('Not implemented'); }
}

module.exports = { PlayerGroupRepositoryPort };
