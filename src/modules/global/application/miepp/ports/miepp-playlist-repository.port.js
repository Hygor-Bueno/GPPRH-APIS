/**
 * @fileoverview Porta de playlists e seus itens.
 *
 * Compartilhada entre a sub-feature `playlist` (painel) e a sub-feature
 * `device` (que lê os itens da playlist resolvida), por isso leva o prefixo da
 * suite.
 *
 * @module modules/global/application/miepp/ports/miepp-playlist-repository.port
 */

class MieppPlaylistRepositoryPort {
    /** @param {object} filters @returns {Promise<{rows: object[], total: number}>} */
    list(filters) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<object|null>} */
    findById(id) { throw new Error('Not implemented'); }

    /** @param {object} payload @returns {Promise<number>} */
    create(payload) { throw new Error('Not implemented'); }

    /** @param {number} id @param {object} payload @returns {Promise<void>} */
    update(id, payload) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<void>} */
    remove(id) { throw new Error('Not implemented'); }

    /** Quantos agendamentos usam a playlist — guarda do DELETE. @returns {Promise<number>} */
    countScheduleUsage(id) { throw new Error('Not implemented'); }

    /**
     * Itens com a mídia resolvida, ordenados — insumo do shaper de item.
     * @param {number} playlistId
     * @returns {Promise<object[]>}
     */
    findItems(playlistId) { throw new Error('Not implemented'); }

    /** @param {number} playlistId @param {object} payload @returns {Promise<number>} */
    addItem(playlistId, payload) { throw new Error('Not implemented'); }

    /** @param {number} playlistId @param {number} itemId @param {object} payload @returns {Promise<boolean>} */
    updateItem(playlistId, itemId, payload) { throw new Error('Not implemented'); }

    /** @param {number} playlistId @param {number} itemId @returns {Promise<boolean>} */
    removeItem(playlistId, itemId) { throw new Error('Not implemented'); }

    /** @param {number} playlistId @returns {Promise<number[]>} */
    findItemIds(playlistId) { throw new Error('Not implemented'); }

    /**
     * Grava a nova ordem inteira numa transação.
     * @param {number} playlistId
     * @param {number[]} orderedItemIds - ordem final; o índice vira `order_index`.
     * @returns {Promise<void>}
     */
    reorderItems(playlistId, orderedItemIds) { throw new Error('Not implemented'); }
}

module.exports = { MieppPlaylistRepositoryPort };
