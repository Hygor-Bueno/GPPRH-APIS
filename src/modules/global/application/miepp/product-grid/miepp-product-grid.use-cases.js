/**
 * @fileoverview Casos de uso da grade de produtos (`miepp_product_grids`).
 *
 * ─── A regra que este módulo existe para sustentar ───────────────────────────
 *
 * A grade guarda ESCOLHA, não produto. O payload aceito tem `plu`, `order_index`
 * e `label_override` — e nada mais por item. Descrição, EAN, preço e promoção
 * são recusados explicitamente (`REJECTED_ITEM_FIELDS`), com mensagem dizendo o
 * porquê, em vez de ignorados em silêncio: um front que os envia acredita que
 * estão sendo gravados, e um dia alguém vai ler o preço daqui em vez de ler do
 * Consinco. Recusar é o que transforma a decisão de arquitetura em contrato.
 *
 * O preço exibido na parede é lido do Consinco no momento do render. Não há
 * cache de preço em lugar nenhum deste módulo.
 *
 * @module modules/global/application/miepp/product-grid/miepp-product-grid.use-cases
 */

const crypto = require('crypto');

const { AppError } = require('../../../../../errors/app.error');
const { normalizePagination, optionalFlag, paginated } = require('../../../domain/miepp/pagination.rules');
const {
    DEFAULT_COLUMNS,
    DEFAULT_ROWS,
    DEFAULT_STALE_AFTER_MINUTES,
    MIN_AXIS,
    MAX_AXIS,
    capacity,
    normalizeAxis,
    normalizeItems,
    findDuplicatePlu,
    findInvalidPlu,
    shapeGrid,
} = require('../../../domain/miepp/product-grid/product-grid.rules');
const {
    findStyleError,
    normalizeStyle,
} = require('../../../domain/miepp/product-grid/grid-style.rules');

/** Duração padrão da grade na tela, em segundos. */
const DEFAULT_DURATION_SECONDS = 15;

/**
 * Campos de produto que NÃO podem chegar no item. Ver o cabeçalho.
 * @type {string[]}
 */
const REJECTED_ITEM_FIELDS = [
    'description', 'price', 'price_promotion', 'promotion', 'barcode', 'ean', 'store', 'status',
];

class MieppProductGridUseCases {
    /**
     * @param {object} deps
     * @param {import('./ports/product-grid-repository.port').ProductGridRepositoryPort} deps.repository
     */
    constructor({ repository }) {
        this.repository = repository;
    }

    /** @private @returns {Promise<object>} linha crua; 404 se não existir. */
    async _requireGrid(id) {
        const grid = await this.repository.findById(id);
        if (!grid) throw new AppError('Grade de produtos não encontrada.', 404);
        return grid;
    }

    /** @private Monta a resposta completa (grade + itens). */
    async _shape(row) {
        const items = await this.repository.findItems(row.id);
        return shapeGrid(row, items);
    }

    /**
     * Valida a lista de itens contra o layout.
     *
     * `items` não é validado pelo `validate.middleware` porque aquele formato só
     * conhece string, number e boolean — array de objeto não se expressa lá. A
     * validação de estrutura precisa mesmo morar aqui.
     *
     * @private
     * @param {*} rawItems
     * @param {{grid_columns: number, grid_rows: number}} layout
     * @returns {Array<object>} itens normalizados.
     */
    _validateItems(rawItems, layout) {
        if (!Array.isArray(rawItems)) {
            throw new AppError('O campo "items" é obrigatório e precisa ser uma lista.', 400);
        }

        for (const item of rawItems) {
            if (item === null || typeof item !== 'object') {
                throw new AppError('Cada item precisa ser um objeto com "plu".', 400);
            }
            const offending = REJECTED_ITEM_FIELDS.filter(field => field in item);
            if (offending.length) {
                throw new AppError(
                    `Não envie dado de produto na grade (${offending.join(', ')}). ` +
                    'A grade guarda apenas o PLU; descrição e preço são lidos do Consinco ' +
                    'no momento em que a imagem é gerada.',
                    400
                );
            }
        }

        const items = normalizeItems(rawItems);

        const invalid = findInvalidPlu(items);
        if (invalid !== null) {
            throw new AppError(`PLU inválido: "${invalid}". Informe um número inteiro positivo.`, 400);
        }

        const duplicated = findDuplicatePlu(items);
        if (duplicated !== null) {
            throw new AppError(`O produto ${duplicated} está repetido na grade.`, 400);
        }

        const limit = capacity(layout);
        if (items.length > limit) {
            throw new AppError(
                `A grade comporta ${limit} produtos (${layout.grid_columns}x${layout.grid_rows}) ` +
                `e recebeu ${items.length}.`,
                400
            );
        }

        return items;
    }

    /**
     * Valida e normaliza o estilo recebido.
     *
     * Mesma razão do `_validateItems` morar aqui: o `validate.middleware` só
     * conhece string, number e boolean, e o estilo é objeto aninhado.
     *
     * Recusa em vez de corrigir. Um valor de cor fora do formato viraria CSS
     * inválido, que o Chromium descarta em silêncio — a grade sairia com a cor
     * antiga e ninguém saberia por quê. Errar alto aqui é o que evita o
     * chamado de suporte.
     *
     * @private
     * @param {*} raw
     * @param {object|null} current - estilo atual, para o PUT parcial.
     * @returns {object}
     */
    _validateStyle(raw, current = null) {
        const problem = findStyleError(raw);
        if (problem) throw new AppError(problem, 400);
        return normalizeStyle(raw, current);
    }

    /** @private Layout normalizado a partir do payload, com defaults. */
    _layoutFrom(payload, current = null) {
        return {
            grid_columns: normalizeAxis(
                payload.grid_columns ?? current?.grid_columns,
                current ? Number(current.grid_columns) : DEFAULT_COLUMNS
            ),
            grid_rows: normalizeAxis(
                payload.grid_rows ?? current?.grid_rows,
                current ? Number(current.grid_rows) : DEFAULT_ROWS
            ),
        };
    }

    async list(query = {}) {
        const pagination = normalizePagination(query);
        const { rows, total } = await this.repository.list({
            ...pagination,
            active: optionalFlag(query.active),
            shop_id: query.shop_id ? Number(query.shop_id) : null,
        });

        // Sem os itens: a listagem do painel mostra título, loja e estado. Puxar
        // os PLUs de 50 grades aqui seriam 50 queries para dado que a tela nem
        // exibe. Os itens vêm no GET por id.
        return paginated(rows.map(row => shapeGrid(row, [])), total, pagination);
    }

    async getById(id) {
        return this._shape(await this._requireGrid(id));
    }

    /**
     * Cria a grade e a mídia que ela alimenta, numa transação só.
     *
     * A imagem de fundo NÃO vem aqui: sobe depois, em
     * `POST /product-grids/:id/background`. Misturar multipart com uma lista de
     * itens em JSON exigiria serializar `items` como string dentro do form, e é
     * exatamente aí que erro de escape aparece em produção.
     */
    async create(payload, actor) {
        const layout = this._layoutFrom(payload);
        const items = this._validateItems(payload.items, layout);
        const style = this._validateStyle(payload.style);

        const gridId = await this.repository.create({
            uuid: crypto.randomUUID(),
            title: payload.title,
            duration_seconds: Number(payload.duration_seconds ?? DEFAULT_DURATION_SECONDS),
            shop_id: Number(payload.shop_id),
            grid_columns: layout.grid_columns,
            grid_rows: layout.grid_rows,
            stale_after_minutes: Number(payload.stale_after_minutes ?? DEFAULT_STALE_AFTER_MINUTES),
            style,
            active: payload.active === undefined ? 1 : Number(payload.active),
            created_by: actor?.id ?? null,
            items,
        });

        return this._shape(await this.repository.findById(gridId));
    }

    /**
     * Atualiza a grade. Os itens são SUBSTITUÍDOS quando `items` vem no payload;
     * omitir o campo preserva a lista atual.
     *
     * Trocar a loja mantém os PLUs, e isso é deliberado: recusar obrigaria a
     * refazer a grade inteira por causa de um campo. O que o painel precisa
     * avisar é que um PLU pode não existir na outra loja — quem descobre isso é
     * o render, que registra o erro em `last_error`.
     */
    async update(id, payload) {
        const current = await this._requireGrid(id);
        const layout = this._layoutFrom(payload, current);

        // Com layout menor e `items` omitido, os itens que já estão gravados
        // podem não caber mais. Valida contra a lista efetiva, não contra a
        // recebida.
        const rawItems = payload.items !== undefined
            ? payload.items
            : await this.repository.findItems(id);

        const items = this._validateItems(rawItems, layout);

        // Estilo é mesclado, não substituído: o painel pode mandar só a cor do
        // preço sem reenviar o resto, do mesmo jeito que já faz com `title`.
        const style = this._validateStyle(payload.style, current.style);

        await this.repository.update(id, {
            media_id: Number(current.media_id),
            title: payload.title ?? current.title,
            duration_seconds: Number(payload.duration_seconds ?? current.duration_seconds),
            shop_id: Number(payload.shop_id ?? current.shop_id),
            grid_columns: layout.grid_columns,
            grid_rows: layout.grid_rows,
            stale_after_minutes: Number(payload.stale_after_minutes ?? current.stale_after_minutes),
            style,
            active: payload.active === undefined ? Number(current.active) : Number(payload.active),
            items,
        });

        return this._shape(await this.repository.findById(id));
    }

    /**
     * Registra a imagem de fundo já gravada em `_files`.
     *
     * Quem grava o binário é o `MieppMediaStorageService`, no controller — a
     * mesma porta que a mídia comum usa. Aqui só guardamos o id e zeramos o
     * `data_hash`, porque trocar o fundo muda a imagem final.
     *
     * O `FileService` aceita PDF, planilha e vídeo, que passariam por esta rota
     * sem reclamar e só falhariam lá na frente, dentro do renderizador, com uma
     * mensagem sobre biblioteca de imagem. Recusar aqui devolve o erro a quem
     * ainda está com o arquivo na mão.
     *
     * @param {number} id
     * @param {{file_id: number, mime_type: string}} stored - retorno do storage.
     */
    async setBackground(id, stored) {
        await this._requireGrid(id);

        if (!String(stored?.mime_type ?? '').startsWith('image/')) {
            throw new AppError(
                `O fundo precisa ser uma imagem (recebido: ${stored?.mime_type ?? 'desconhecido'}).`,
                400
            );
        }

        await this.repository.setBackground(id, Number(stored.file_id));
        return this._shape(await this.repository.findById(id));
    }

    /**
     * Marca a grade para renderizar no próximo ciclo (zera `data_hash`).
     *
     * ⚠️ NÃO gera a imagem aqui, e nem por isso é o único caminho até ela:
     * quem desenha é o worker `miepp-grid-renderer`, lendo `data_hash IS NULL`
     * no próximo ciclo. Mudar item, layout ou ESTILO pelo PUT já zera o
     * `data_hash` (`SQL_UPDATE_GRID`), então a grade redesenha sozinha sem
     * passar por aqui — o que esta rota compra é prioridade na fila, não o
     * render. Ver `docs/miepp.md`.
     */
    async requestRender(id) {
        const grid = await this._requireGrid(id);
        await this.repository.requestRender(id);

        return {
            id: Number(grid.id),
            requested: true,
            rendered: false,
            message: 'Grade marcada para renderização no próximo ciclo.',
        };
    }

    /**
     * Remove a grade apagando a MÍDIA (o CASCADE leva grade, itens e trilha).
     *
     * Recusa quando a mídia está em alguma playlist: `miepp_playlist_items` tem
     * ON DELETE CASCADE, então seguir em frente arrancaria o item da playlist
     * sem ninguém perceber. Mesma guarda da mídia comum.
     */
    async remove(id) {
        const grid = await this._requireGrid(id);

        const usage = await this.repository.countUsage(Number(grid.media_id));
        if (usage > 0) {
            throw new AppError(
                `Esta grade está em ${usage} playlist(s). Remova-a das playlists antes de excluir.`,
                409
            );
        }

        await this.repository.remove(Number(grid.media_id));
        return { id: Number(id) };
    }

    async listRenders(id, query = {}) {
        await this._requireGrid(id);
        const pagination = normalizePagination(query);
        const { rows, total } = await this.repository.listRenders({ gridId: id, ...pagination });
        return paginated(rows, total, pagination);
    }
}

module.exports = {
    MieppProductGridUseCases,
    DEFAULT_DURATION_SECONDS,
    REJECTED_ITEM_FIELDS,
    MIN_AXIS,
    MAX_AXIS,
};
