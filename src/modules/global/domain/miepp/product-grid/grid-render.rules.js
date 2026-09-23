/**
 * @fileoverview Regras puras do ciclo de render da grade.
 *
 * Todo o julgamento do ciclo mora aqui — o que a grade deveria mostrar, se ela
 * pode ir ao ar, e se o conteúdo mudou desde o último render. Nada de I/O, para
 * que a decisão que tira uma grade de preço do ar seja testável sem Oracle,
 * sem MySQL e sem navegador.
 *
 * @module modules/global/domain/miepp/product-grid/grid-render.rules
 */

const crypto = require('crypto');

const { styleFingerprint } = require('./grid-style.rules');

/**
 * Resolve os itens da grade contra o que o Consinco devolveu.
 *
 * O Consinco devolve SÓ os ativos (ver `miepp-product-grid.oracle.queries`),
 * então "não voltou" significa inativo, inexistente ou de outra loja — e a
 * distinção entre esses três casos não muda o que fazemos.
 *
 * @param {Array<{plu: number, order_index: number, label_override: string|null}>} items
 * @param {Array<object>} rows - linhas do Oracle (`PLU`, `DESCRIPTION`, …).
 * @returns {{resolved: object[], missing: number[]}}
 */
function resolveItems(items = [], rows = []) {
    const byPlu = new Map(rows.map(row => [Number(row.PLU), row]));

    const resolved = [];
    const missing = [];

    for (const item of [...items].sort((a, b) => a.order_index - b.order_index)) {
        const row = byPlu.get(Number(item.plu));

        if (!row) {
            missing.push(Number(item.plu));
            continue;
        }

        const promotion = Number(row.PRICE_PROMOTION || 0);

        resolved.push({
            plu: Number(item.plu),
            order_index: Number(item.order_index),
            // `label_override` é escolha do editor e vence a descrição do ERP.
            // Quando é null, a descrição atual do Consinco é usada — por isso
            // ela NUNCA é gravada de volta na curadoria.
            label: item.label_override || row.DESCRIPTION || '',
            description: row.DESCRIPTION ?? null,
            barcode: row.BARCODE != null ? String(row.BARCODE) : null,
            price: Number(row.PRICE || 0),
            price_promotion: promotion > 0 ? promotion : null,
            promotion: promotion > 0,
        });
    }

    return { resolved, missing };
}

/**
 * Impressão digital do que a imagem mostraria.
 *
 * É o que evita re-renderizar de 5 em 5 minutos uma imagem idêntica: sem ele, o
 * checksum da mídia mudaria a cada ciclo e as 20+ telas da loja rebaixariam o
 * mesmo arquivo 288 vezes por dia, pelo wifi da loja.
 *
 * Entra tudo que altera o resultado visual — layout, fundo e estilo inclusive.
 * NÃO entram `id`, `updated_at` nem qualquer carimbo de tempo: incluí-los faria
 * o hash mudar sozinho e anularia a função inteira.
 *
 * ⚠️ Esquecer um campo aqui é a falha mais cara deste módulo, e ela é silenciosa:
 * o usuário muda a cor no painel, salva, e nada acontece — sem render, sem erro,
 * sem uma linha no log explicando. Qualquer campo novo que chegue ao template
 * precisa entrar nesta impressão digital no mesmo commit.
 *
 * @param {{grid_columns: number, grid_rows: number, background_file_id: number|null, style: object|null}} grid
 * @param {object[]} resolved - saída de `resolveItems`.
 * @returns {string} SHA-256 em hex.
 */
function computeDataHash(grid, resolved = []) {
    const shape = {
        columns: Number(grid.grid_columns),
        rows: Number(grid.grid_rows),
        background: grid.background_file_id === null || grid.background_file_id === undefined
            ? null
            : Number(grid.background_file_id),
        // `styleFingerprint` normaliza antes de achatar: grade sem estilo
        // próprio produz a mesma digital do estilo padrão, e não re-renderiza
        // só porque a coluna está nula.
        style: styleFingerprint(grid.style),
        items: resolved.map(item => [
            item.order_index,
            item.plu,
            item.label,
            item.price,
            item.price_promotion,
        ]),
    };

    return crypto.createHash('sha256').update(JSON.stringify(shape)).digest('hex');
}

/**
 * Decide o que fazer com a grade neste ciclo.
 *
 * Três saídas, e a diferença entre elas é o que o painel vai mostrar:
 *
 *  - `off_air`  — algum produto saiu de linha. A grade inteira sai do ar
 *                 (decisão do requerente, 16/09/2026). Renderizar com buraco
 *                 mostraria uma vitrine furada; renderizar sem o item mudaria o
 *                 layout que alguém aprovou.
 *  - `unchanged`— nada mudou desde o último render. Não gera imagem.
 *  - `render`   — conteúdo novo, gera imagem.
 *
 * Uma grade SEM itens é `off_air`: não existe grade de zero produtos, e
 * renderizar um fundo vazio ocuparia a tela sem dizer nada.
 *
 * @param {object} grid - linha de `miepp_product_grids` (precisa de `data_hash`).
 * @param {{resolved: object[], missing: number[]}} resolution
 * @param {string} dataHash
 * @returns {{action: 'off_air'|'unchanged'|'render', reason: string|null}}
 */
function decideRender(grid, resolution, dataHash) {
    if (resolution.missing.length > 0) {
        return {
            action: 'off_air',
            reason: `Fora do ar: ${resolution.missing.length} produto(s) sem cadastro ativo na loja `
                  + `${grid.shop_id} (PLU ${resolution.missing.join(', ')}).`,
        };
    }

    if (resolution.resolved.length === 0) {
        return { action: 'off_air', reason: 'Fora do ar: a grade não tem produtos.' };
    }

    if (grid.data_hash && grid.data_hash === dataHash) {
        return { action: 'unchanged', reason: null };
    }

    return { action: 'render', reason: null };
}

/**
 * Formata valor como preço brasileiro, sem símbolo.
 *
 * Fica no domínio, e não no template, porque é o texto que vai para a parede e
 * para o `snapshot` da trilha — os dois precisam dizer exatamente a mesma coisa
 * quando alguém reclamar de um preço.
 *
 * @param {number} value
 * @returns {string} ex.: `6,99`
 */
function formatPrice(value) {
    return Number(value || 0).toFixed(2).replace('.', ',');
}

module.exports = {
    resolveItems,
    computeDataHash,
    decideRender,
    formatPrice,
};
