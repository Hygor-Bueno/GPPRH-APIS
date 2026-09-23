/**
 * @fileoverview Ciclo de render da grade de produtos.
 *
 * Orquestra, não decide: o julgamento está em `grid-render.rules` (puro), o SQL
 * no adapter e o Chromium no serviço de render. Aqui fica a ordem das coisas e
 * o tratamento de falha.
 *
 * ─── O que cada desfecho significa ───────────────────────────────────────────
 *
 * | Desfecho    | `last_checked_at` | Mídia    | Tela |
 * |-------------|-------------------|----------|------|
 * | `rendered`  | agora             | `ready`  | mostra a imagem nova |
 * | `unchanged` | agora             | intacta  | continua mostrando a mesma |
 * | `off_air`   | agora             | `error`  | some da playlist |
 * | `failed`    | **não muda**      | intacta  | envelhece até `stale` e some |
 *
 * A diferença entre `off_air` e `failed` é a que protege a parede: em `off_air`
 * nós consultamos e sabemos que não dá para exibir; em `failed` não
 * conseguimos consultar, e carimbar a hora diria que os preços foram
 * conferidos quando não foram.
 *
 * @module modules/global/application/miepp/product-grid/miepp-grid-render.use-cases
 */

const { MediaStatus } = require('../../../domain/miepp/miepp.enums');
const {
    resolveItems,
    computeDataHash,
    decideRender,
    formatPrice,
} = require('../../../domain/miepp/product-grid/grid-render.rules');
const { normalizeStyle } = require('../../../domain/miepp/product-grid/grid-style.rules');

class MieppGridRenderUseCases {
    /**
     * @param {object} deps
     * @param {import('./ports/product-grid-repository.port').ProductGridRepositoryPort} deps.repository
     * @param {{findActiveProductsByPlus: Function}} deps.productSource - Consinco.
     * @param {{render: Function, open: Function, close: Function}} deps.renderer
     * @param {{save: Function, resolve: Function}} deps.storage - `MieppMediaStorageService`.
     */
    constructor({ repository, productSource, renderer, storage }) {
        this.repository = repository;
        this.productSource = productSource;
        this.renderer = renderer;
        this.storage = storage;
    }

    /**
     * Roda um ciclo completo.
     *
     * O Chromium abre uma vez para o lote inteiro e fecha no `finally` — ver o
     * cabeçalho de `miepp-grid-renderer.service` para o porquê de não manter
     * instância viva entre ciclos.
     *
     * Falha de uma grade NUNCA interrompe o lote: 20 grades e a terceira com
     * PLU problemático não podem deixar as outras 17 envelhecerem até sair do
     * ar.
     *
     * @param {number} [limit=20]
     * @returns {Promise<{rendered: number, unchanged: number, off_air: number, failed: number}>}
     */
    async runCycle(limit = 20) {
        const grids = await this.repository.listToRender(limit);
        const tally = { rendered: 0, unchanged: 0, off_air: 0, failed: 0 };

        if (grids.length === 0) return tally;

        try {
            for (const grid of grids) {
                const outcome = await this.renderGrid(grid);
                tally[outcome] += 1;
            }
        } finally {
            await this.renderer.close();
        }

        return tally;
    }

    /**
     * Processa UMA grade.
     *
     * @param {object} grid - linha de `SQL_LIST_GRIDS_TO_RENDER`.
     * @returns {Promise<'rendered'|'unchanged'|'off_air'|'failed'>}
     */
    async renderGrid(grid) {
        try {
            const items = await this.repository.findItems(grid.id);
            const rows = await this.productSource.findActiveProductsByPlus(
                Number(grid.shop_id),
                items.map(item => Number(item.plu)),
            );

            const resolution = resolveItems(items, rows);
            const dataHash = computeDataHash(grid, resolution.resolved);
            const decision = decideRender(grid, resolution, dataHash);

            if (decision.action === 'off_air') {
                await this.repository.markOffAir(grid.id, decision.reason.slice(0, 255));
                // É esta linha que tira a grade da tela: o `isPlayable` do
                // shaper só deixa passar `ready`.
                await this.repository.setMediaStatus(Number(grid.media_id), MediaStatus.ERROR);
                console.warn(`[miepp-grid] grade ${grid.id} fora do ar — ${decision.reason}`);
                return 'off_air';
            }

            if (decision.action === 'unchanged') {
                await this.repository.markChecked(grid.id);
                return 'unchanged';
            }

            await this._render(grid, resolution.resolved, dataHash);
            return 'rendered';
        } catch (error) {
            // Não carimba `last_checked_at`: a grade envelhece e sai do ar
            // sozinha se a falha persistir. Ver o cabeçalho.
            await this.repository.markFailed(grid.id, error.message).catch(() => {});
            console.error(`[miepp-grid] grade ${grid.id} falhou:`, error.message);
            return 'failed';
        }
    }

    /**
     * Gera a imagem, grava em `_files` e publica.
     *
     * A ordem importa: o arquivo vai para `_files` ANTES de `miepp_media`
     * apontar para ele. Invertida, uma falha de gravação deixaria a mídia
     * apontando para um id que não existe — e o player baixaria 404 em loop.
     *
     * @private
     */
    async _render(grid, resolved, dataHash) {
        const background = grid.background_file_id
            ? await this.storage.resolve(grid.background_file_id).catch(() => null)
            : null;

        const style = normalizeStyle(grid.style);

        const png = await this.renderer.render({
            columns: Number(grid.grid_columns),
            rows: Number(grid.grid_rows),
            items: resolved,
            background,
            style,
        });

        // O `FileService` deduplica por SHA-256 e converte PNG para WebP. Se a
        // imagem sair idêntica a uma anterior, ele devolve o registro existente
        // sem gravar nada — e o checksum não muda, então as telas não rebaixam.
        const stored = await this.storage.save({
            buffer: png,
            originalname: `grade-${grid.id}.png`,
            size: png.length,
        }, null);

        await this.repository.setMediaFile(Number(grid.media_id), stored);
        await this.repository.markRendered(grid.id, dataHash);

        await this.repository.insertRender({
            gridId: grid.id,
            dataHash,
            fileId: Number(stored.file_id),
            checksum: stored.checksum,
            snapshot: MieppGridRenderUseCases.toSnapshot(resolved, grid, style),
        });

        console.log(`[miepp-grid] grade ${grid.id} renderizada (${resolved.length} itens, ${stored.checksum.slice(0, 8)})`);
    }

    /**
     * O que a parede mostrou, para a trilha.
     *
     * Guarda o preço **formatado como foi exibido**, não só o número: quando um
     * cliente reclamar, a pergunta é o que estava escrito na tela, e um
     * arredondamento a mais no caminho até a imagem tornaria o número bruto
     * insuficiente como resposta.
     *
     * Guarda também `layout` e `style`, e não só os itens. A versão anterior
     * gravava apenas a lista de produtos, e isso custou caro em 18/09/2026: dois
     * renders com o mesmo snapshot produziram imagens diferentes, e levou uma
     * investigação inteira para descobrir que o que havia mudado era o número de
     * colunas. Trilha que não explica a diferença entre dois renders não está
     * cumprindo o papel de trilha.
     *
     * @param {object[]} resolved
     * @param {{grid_columns: number, grid_rows: number, background_file_id: number|null}} grid
     * @param {object} style - estilo já normalizado, o mesmo que foi ao template.
     * @returns {{items: object[], layout: object, style: object}}
     */
    static toSnapshot(resolved, grid = {}, style = null) {
        return {
            items: resolved.map(item => ({
                plu: item.plu,
                order_index: item.order_index,
                label: item.label,
                description: item.description,
                barcode: item.barcode,
                price: item.price,
                price_promotion: item.price_promotion,
                promotion: item.promotion,
                exibido: item.promotion && item.price_promotion !== null
                    ? `R$ ${formatPrice(item.price_promotion)}`
                    : `R$ ${formatPrice(item.price)}`,
            })),
            layout: {
                grid_columns: grid.grid_columns === undefined ? null : Number(grid.grid_columns),
                grid_rows: grid.grid_rows === undefined ? null : Number(grid.grid_rows),
                background_file_id: grid.background_file_id === null || grid.background_file_id === undefined
                    ? null
                    : Number(grid.background_file_id),
            },
            style: normalizeStyle(style),
        };
    }
}

module.exports = { MieppGridRenderUseCases };
