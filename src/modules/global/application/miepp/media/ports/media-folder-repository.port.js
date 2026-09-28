/**
 * @fileoverview Porta de `miepp_media_folders`.
 *
 * Mora em `media/` porque pasta é organização da biblioteca de mídia, e não
 * uma sub-feature com vida própria: nenhuma outra tabela aponta para ela.
 *
 * @module modules/global/application/miepp/media/ports/media-folder-repository.port
 */

class MediaFolderRepositoryPort {
    /**
     * Todas as pastas, com `folder_count` e `media_count`. Sem paginação: o
     * painel monta a árvore inteira.
     * @returns {Promise<object[]>}
     */
    list() { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<object|null>} */
    findById(id) { throw new Error('Not implemented'); }

    /** Contagens do nó raiz (que não é linha de tabela). @returns {Promise<{folder_count: number, media_count: number}>} */
    countRoot() { throw new Error('Not implemented'); }

    /**
     * Caminho da raiz até a pasta, incluindo ela. Vazio se a pasta não existe.
     * O tamanho é a profundidade da pasta (pasta na raiz = 1).
     * @param {number} id @returns {Promise<{id: number, name: string}[]>}
     */
    getPath(id) { throw new Error('Not implemented'); }

    /** Níveis que a pasta carrega consigo (1 = sem subpastas). @param {number} id @returns {Promise<number>} */
    getSubtreeHeight(id) { throw new Error('Not implemented'); }

    /**
     * Nome repetido entre irmãs vira 409 no adapter (chave única).
     * @param {{parent_id: ?number, name: string, created_by: ?number}} payload
     * @returns {Promise<number>} id criado.
     */
    create(payload) { throw new Error('Not implemented'); }

    /** @param {number} id @param {{parent_id: ?number, name: string}} payload @returns {Promise<void>} */
    update(id, payload) { throw new Error('Not implemented'); }

    /** Pasta com conteúdo vira 409 no adapter (FK RESTRICT). @param {number} id @returns {Promise<void>} */
    remove(id) { throw new Error('Not implemented'); }
}

module.exports = { MediaFolderRepositoryPort };
