/**
 * @fileoverview Regras puras da grade de produtos.
 *
 * Sem I/O e sem `AppError` — devolve diagnóstico, quem decide o status HTTP é o
 * caso de uso. Mesma divisão do `playlist-item.shaper`.
 *
 * O que NÃO mora aqui, de propósito:
 *  - o cálculo de `stale`, que é feito em SQL (`GRID_STALE_EXPRESSION`). Duas
 *    implementações do mesmo critério divergiriam, e a do banco é obrigatória:
 *    é ela que vai excluir a grade vencida da playlist do player.
 *  - qualquer dado de produto. Esta camada conhece PLU e posição; descrição e
 *    preço vêm do Consinco no momento do render.
 *
 * @module modules/global/domain/miepp/product-grid/product-grid.rules
 */

const { normalizeStyle } = require('./grid-style.rules');

/** Limites de cada eixo do mosaico. Acima de 6x6 nada é legível numa parede. */
const MIN_AXIS = 1;
const MAX_AXIS = 6;

/** Usado quando o payload não informa o layout. */
const DEFAULT_COLUMNS = 3;
const DEFAULT_ROWS = 3;

/**
 * Sem consulta ao Consinco por este tempo, a grade sai do ar. Default de
 * `miepp_product_grids.stale_after_minutes`.
 */
const DEFAULT_STALE_AFTER_MINUTES = 20;

/**
 * Quantos produtos cabem no mosaico.
 *
 * @param {{grid_columns: number, grid_rows: number}} layout
 * @returns {number}
 */
function capacity({ grid_columns, grid_rows }) {
    return Number(grid_columns) * Number(grid_rows);
}

/**
 * Valor de eixo dentro da faixa, com default.
 *
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizeAxis(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.trunc(parsed), MIN_AXIS), MAX_AXIS);
}

/**
 * Normaliza a lista de itens recebida do painel.
 *
 * Reindexa `order_index` para `0..n-1` na ordem enviada: o front manda a ordem
 * que o usuário arrastou, e aceitar os números dele deixaria buracos e empates
 * que o `ORDER BY` resolveria de forma arbitrária.
 *
 * `label_override` vazio vira `null` — e `null` significa "usar a descrição do
 * Consinco". Gravar string vazia mudaria o significado para "sem texto".
 *
 * @param {Array<{plu: *, order_index?: *, label_override?: *}>} items
 * @returns {Array<{plu: number, order_index: number, label_override: string|null}>}
 */
function normalizeItems(items = []) {
    return [...items]
        .map((item, index) => ({
            plu: Number(item.plu),
            // Sem `order_index` no payload, vale a ordem do array.
            order_index: Number.isFinite(Number(item.order_index))
                ? Number(item.order_index)
                : index,
            label_override: typeof item.label_override === 'string' && item.label_override.trim() !== ''
                ? item.label_override.trim()
                : null,
        }))
        .sort((left, right) => left.order_index - right.order_index)
        .map((item, index) => ({ ...item, order_index: index }));
}

/**
 * Primeiro PLU repetido, ou `null`.
 *
 * O banco já recusa pela UNIQUE `(grid_id, plu)`, mas o erro 1062 chegaria ao
 * painel como 500 genérico. Detectar antes permite dizer QUAL produto está
 * duplicado.
 *
 * @param {Array<{plu: number}>} items
 * @returns {number|null}
 */
function findDuplicatePlu(items = []) {
    const seen = new Set();
    for (const item of items) {
        if (seen.has(item.plu)) return item.plu;
        seen.add(item.plu);
    }
    return null;
}

/**
 * Primeiro PLU inválido (não inteiro positivo), ou `null`.
 *
 * @param {Array<{plu: number}>} items
 * @returns {*}
 */
function findInvalidPlu(items = []) {
    const invalid = items.find(item => !Number.isInteger(item.plu) || item.plu < 1);
    return invalid ? invalid.plu : null;
}

/**
 * Monta a resposta HTTP da grade a partir da linha do banco e dos itens.
 *
 * `stale` vem do SQL como 0/1 e sai como booleano — o painel decide se mostra o
 * alerta vermelho com base nele, e comparar `=== 1` do outro lado é fonte
 * garantida de bug.
 *
 * @param {object} row - linha de `miepp_product_grids` + join com `miepp_media`.
 * @param {object[]} items
 * @returns {object}
 */
function shapeGrid(row, items = []) {
    if (!row) return null;

    return {
        id: Number(row.id),
        title: row.title,
        shop_id: Number(row.shop_id),
        media: {
            id: Number(row.media_id),
            uuid: row.media_uuid,
            status: row.media_status,
            duration_seconds: Number(row.duration_seconds),
        },
        background_file_id: row.background_file_id === null ? null : Number(row.background_file_id),
        grid_columns: Number(row.grid_columns),
        grid_rows: Number(row.grid_rows),
        capacity: capacity(row),
        // Sempre o estilo EFETIVO, nunca a coluna crua: a grade sem estilo
        // próprio devolve o padrão preenchido, e o editor do painel monta os
        // campos a partir da resposta sem precisar conhecer default nenhum.
        style: normalizeStyle(row.style),
        stale_after_minutes: Number(row.stale_after_minutes),
        data_hash: row.data_hash,
        last_checked_at: row.last_checked_at,
        last_rendered_at: row.last_rendered_at,
        last_error: row.last_error,
        stale: Boolean(Number(row.stale)),
        active: Boolean(Number(row.active)),
        created_by: row.created_by === null ? null : Number(row.created_by),
        created_at: row.created_at,
        updated_at: row.updated_at,
        items: items.map(item => ({
            plu: Number(item.plu),
            order_index: Number(item.order_index),
            label_override: item.label_override,
        })),
    };
}

module.exports = {
    MIN_AXIS,
    MAX_AXIS,
    DEFAULT_COLUMNS,
    DEFAULT_ROWS,
    DEFAULT_STALE_AFTER_MINUTES,
    capacity,
    normalizeAxis,
    normalizeItems,
    findDuplicatePlu,
    findInvalidPlu,
    shapeGrid,
};
