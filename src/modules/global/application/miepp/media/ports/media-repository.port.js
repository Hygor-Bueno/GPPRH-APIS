/**
 * @fileoverview Porta de `miepp_media`.
 *
 * Usada pela sub-feature `media` — sem prefixo de suite. A leitura que o device
 * faz da mídia de PLAYLIST acontece pelo join da playlist, não por aqui; a
 * exceção é o `findForDevice`, que resolve a mídia de reserva — a única que o
 * device alcança sem passar por uma playlist.
 *
 * @module modules/global/application/miepp/media/ports/media-repository.port
 */

class MediaRepositoryPort {
    /**
     * As linhas saem com `grid_id` do LEFT JOIN da grade — é o que permite ao
     * caso de uso derivar `origin`. Sem essa coluna a grade, que é uma mídia
     * `image` como qualquer outra, volta indistinguível de um upload.
     *
     * @param {{type: ?string, status: ?string, origin: ?string, limit: number, offset: number}} filters
     * @returns {Promise<{rows: object[], total: number}>}
     */
    list(filters) { throw new Error('Not implemented'); }

    /** Com `grid_id`, pelo mesmo motivo do `list`. @param {number} id @returns {Promise<object|null>} */
    findById(id) { throw new Error('Not implemented'); }

    /**
     * Sem `grid_id`: quem chama é a entrega do binário, que não monta JSON.
     * @param {string} uuid @returns {Promise<object|null>}
     */
    findByUuid(uuid) { throw new Error('Not implemented'); }

    /**
     * A mídia no MESMO formato de linha que `SQL_GET_PLAYLIST_ITEMS` devolve
     * (`media_uuid` apelidado, `grid_id` do LEFT JOIN da grade) — é o que
     * permite passá-la pelo shaper do item em vez de manter um segundo
     * formato. Usada só para resolver a reserva do device.
     *
     * @param {number} id
     * @returns {Promise<object|null>}
     */
    findForDevice(id) { throw new Error('Not implemented'); }

    /**
     * Registra a mídia. Quando há binário, o adapter já gravou o arquivo pelo
     * `MieppMediaStorageService` e recebe aqui o `file_id` de `_files`.
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
