/**
 * @fileoverview Porta de `meipp_media`.
 *
 * Usada só pela sub-feature `media` — sem prefixo de suite. A leitura que o
 * device faz da mídia acontece pelo join da playlist, não por aqui.
 *
 * @module modules/global/application/meipp/media/ports/media-repository.port
 */

class MediaRepositoryPort {
    /** @param {object} filters @returns {Promise<{rows: object[], total: number}>} */
    list(filters) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<object|null>} */
    findById(id) { throw new Error('Not implemented'); }

    /** @param {string} uuid @returns {Promise<object|null>} */
    findByUuid(uuid) { throw new Error('Not implemented'); }

    /**
     * Registra a mídia. Quando há binário, o adapter já gravou o arquivo pelo
     * `MeippMediaStorageService` e recebe aqui o `file_id` de `_files`.
     * @param {object} payload
     * @returns {Promise<{id: number, uuid: string}>}
     */
    create(payload) { throw new Error('Not implemented'); }

    /** @param {number} id @param {object} payload @returns {Promise<void>} */
    update(id, payload) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<void>} */
    remove(id) { throw new Error('Not implemented'); }

    /** Em quantos itens de playlist a mídia está — guarda do DELETE. @returns {Promise<number>} */
    countPlaylistUsage(id) { throw new Error('Not implemented'); }
}

module.exports = { MediaRepositoryPort };
