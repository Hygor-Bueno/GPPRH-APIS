/**
 * @fileoverview Porta da grade de produtos.
 *
 * Usada só pela sub-feature `product-grid`, então sem o prefixo da suite
 * (convenção da migração GTPP, igual a `location-repository.port`).
 *
 * @module modules/global/application/miepp/product-grid/ports/product-grid-repository.port
 */

class ProductGridRepositoryPort {
    /** @param {object} filters @returns {Promise<{rows: object[], total: number}>} */
    list(filters) { throw new Error('Not implemented'); }

    /**
     * Linha da grade com o JOIN da mídia e o `stale` já derivado.
     * @param {number} id @returns {Promise<object|null>}
     */
    findById(id) { throw new Error('Not implemented'); }

    /** @param {number} gridId @returns {Promise<object[]>} ordenados por `order_index`. */
    findItems(gridId) { throw new Error('Not implemented'); }

    /**
     * Cria mídia, grade e itens numa transação só.
     *
     * `payload.style` chega COMPLETO e já validado — o adapter serializa e
     * grava, sem preencher default nenhum. Quem resolve o padrão é
     * `grid-style.rules`, para que exista um só lugar decidindo aparência.
     *
     * @param {object} payload @returns {Promise<number>} id da grade.
     */
    create(payload) { throw new Error('Not implemented'); }

    /**
     * Atualiza a grade, o título da mídia e SUBSTITUI os itens.
     *
     * Zera o `data_hash` — inclusive quando só o estilo mudou, que é o que faz
     * uma troca de cor virar imagem nova no ciclo seguinte.
     *
     * @param {number} id @param {object} payload @returns {Promise<void>}
     */
    update(id, payload) { throw new Error('Not implemented'); }

    /** @param {number} id @param {number|null} fileId @returns {Promise<void>} */
    setBackground(id, fileId) { throw new Error('Not implemented'); }

    /** Zera `data_hash` para forçar o próximo ciclo de render. @param {number} id */
    requestRender(id) { throw new Error('Not implemented'); }

    /** @param {number} mediaId @returns {Promise<number>} em quantas playlists a grade está. */
    countUsage(mediaId) { throw new Error('Not implemented'); }

    /** Remove a MÍDIA — grade, itens e trilha caem por CASCADE. @param {number} mediaId */
    remove(mediaId) { throw new Error('Not implemented'); }

    /** @param {object} filters @returns {Promise<{rows: object[], total: number}>} */
    listRenders(filters) { throw new Error('Not implemented'); }

    // ─── Ciclo de render ─────────────────────────────────────────────────────

    /** @param {number} limit @returns {Promise<object[]>} grades ativas, mais antiga primeiro. */
    listToRender(limit) { throw new Error('Not implemented'); }

    /** Consultou e nada mudou: mexe só em `last_checked_at`. @param {number} id */
    markChecked(id) { throw new Error('Not implemented'); }

    /** Consultou e a grade não pode ir ao ar. @param {number} id @param {string} reason */
    markOffAir(id, reason) { throw new Error('Not implemented'); }

    /** NÃO conseguiu consultar: registra o erro sem carimbar a hora. @param {number} id @param {string} reason */
    markFailed(id, reason) { throw new Error('Not implemented'); }

    /** @param {number} id @param {string} dataHash */
    markRendered(id, dataHash) { throw new Error('Not implemented'); }

    /** Troca o binário da mídia e a põe `ready`. @param {number} mediaId @param {object} stored */
    setMediaFile(mediaId, stored) { throw new Error('Not implemented'); }

    /** @param {number} mediaId @param {string} status */
    setMediaStatus(mediaId, status) { throw new Error('Not implemented'); }

    /** Grava uma linha na trilha. @param {object} render */
    insertRender(render) { throw new Error('Not implemented'); }
}

module.exports = { ProductGridRepositoryPort };
