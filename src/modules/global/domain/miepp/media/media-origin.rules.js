/**
 * @fileoverview De onde veio o binário de uma mídia: enviado pelo painel ou
 * gerado pelo servidor.
 *
 * Mora aqui, e não em `playlist/playlist-item.shaper`, porque a pergunta não é
 * da playlist: a biblioteca de mídia do painel faz a mesma pergunta sobre a
 * mesma linha. O shaper reexporta o que está aqui para não quebrar quem já o
 * importava.
 *
 * @module modules/global/domain/miepp/media/media-origin.rules
 */

/**
 * De onde veio o binário da mídia.
 *
 * **Não** mora em `miepp.enums` de propósito: aquele arquivo é espelho dos
 * ENUMs do schema, e isto não é coluna nenhuma — é derivado da existência da
 * linha em `miepp_product_grids` (o LEFT JOIN 1:1 que as queries fazem).
 * Guardar como coluna criaria uma segunda verdade para discordar do join.
 *
 * Para o player a diferença importa em duas coisas: `generated` vence (mostra
 * preço) e `generated` repete versões anteriores byte a byte, o que permite
 * uma política de retenção de cache assimétrica. Para o painel importa numa
 * terceira: uma grade tem editor próprio (`/miepp/product-grids/:id`) e não se
 * edita pelo formulário de mídia comum.
 */
const MediaOrigin = Object.freeze({
    /** Enviada pelo painel: institucional, campanha, vídeo. Não vence. */
    UPLOAD: 'upload',
    /** Renderizada pelo servidor a partir do Consinco: grade de produtos. */
    GENERATED: 'generated',
});

/**
 * A mídia foi gerada pelo servidor (grade) ou enviada pelo painel?
 *
 * `grid_id` vem do LEFT JOIN com `miepp_product_grids`, que é 1:1 com a mídia.
 * Linha sem o join (ou de uma query que não o faz) cai em `upload` — é o
 * motivo de toda query que alimenta o front precisar trazer a coluna: sem ela
 * a grade se disfarça de imagem comum, silenciosamente.
 *
 * @param {{grid_id: number|null}} row
 * @returns {'upload'|'generated'}
 */
function resolveOrigin(row) {
    return row.grid_id === null || row.grid_id === undefined
        ? MediaOrigin.UPLOAD
        : MediaOrigin.GENERATED;
}

/**
 * A linha da mídia com `origin` e `grid_id` normalizados, pronta para o JSON
 * da biblioteca do painel.
 *
 * `grid_id` sai junto e não só o `origin` porque o painel precisa dele para
 * levar quem clicou ao editor da grade; `origin` sozinho diria "isto é uma
 * grade" sem dizer qual.
 *
 * @param {object} row - linha de `miepp_media` com `grid_id` do LEFT JOIN.
 * @returns {object} a mesma linha, mais `origin` e `grid_id` (número ou `null`).
 */
function withOrigin(row) {
    if (!row) return row;

    const origin = resolveOrigin(row);

    return {
        ...row,
        grid_id: origin === MediaOrigin.GENERATED ? Number(row.grid_id) : null,
        origin,
    };
}

/**
 * O valor de `?origin=` da listagem, ou `null` quando não há filtro.
 *
 * Qualquer coisa fora do vocabulário vira `null` — "sem filtro" — e não um
 * filtro que ninguém pediu: `?origin=grade` devolvendo só os uploads seria
 * uma resposta plausível e errada, do tipo que ninguém vai investigar.
 *
 * @param {string|undefined} value
 * @returns {'upload'|'generated'|null}
 */
function normalizeOrigin(value) {
    return value === MediaOrigin.UPLOAD || value === MediaOrigin.GENERATED ? value : null;
}

module.exports = { MediaOrigin, resolveOrigin, normalizeOrigin, withOrigin };
