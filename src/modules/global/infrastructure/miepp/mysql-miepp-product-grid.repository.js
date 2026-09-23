/**
 * @fileoverview Adapter MySQL da grade de produtos.
 *
 * @module modules/global/infrastructure/miepp/mysql-miepp-product-grid.repository
 */

const { ProductGridRepositoryPort } = require('../../application/miepp/product-grid/ports/product-grid-repository.port');
const { query, execute, count, transaction, parseJsonColumn } = require('./miepp-mysql.helper');
const {
    SQL_LIST_GRIDS,
    SQL_COUNT_GRIDS,
    SQL_GET_GRID_BY_ID,
    SQL_GET_GRID_ITEMS,
    SQL_INSERT_GRID_MEDIA,
    SQL_INSERT_GRID,
    SQL_INSERT_GRID_ITEM,
    SQL_UPDATE_GRID,
    SQL_UPDATE_GRID_MEDIA_TITLE,
    SQL_UPDATE_GRID_BACKGROUND,
    SQL_DELETE_GRID_ITEMS,
    SQL_CLEAR_GRID_DATA_HASH,
    SQL_DELETE_GRID_MEDIA,
    SQL_COUNT_GRID_USAGE,
    SQL_LIST_GRID_RENDERS,
    SQL_COUNT_GRID_RENDERS,
    SQL_LIST_GRIDS_TO_RENDER,
    SQL_MARK_GRID_CHECKED,
    SQL_MARK_GRID_OFF_AIR,
    SQL_MARK_GRID_FAILED,
    SQL_MARK_GRID_RENDERED,
    SQL_SET_GRID_MEDIA_FILE,
    SQL_SET_GRID_MEDIA_STATUS,
    SQL_INSERT_GRID_RENDER,
} = require('../../repositories/mysql/miepp-product-grid.queries');

/**
 * Normaliza a coluna JSON `style` na borda.
 *
 * Mesmo motivo do `snapshot` em `listRenders`: o driver devolve coluna JSON ora
 * como objeto, ora como string, dependendo da versão do servidor. Deixar a
 * decisão para quem consome faria o mesmo campo sair de dois jeitos na resposta
 * HTTP — e, pior, entrar de dois jeitos no `data_hash`.
 *
 * `null` é preservado: significa "grade sem estilo próprio", e quem resolve o
 * padrão é o domínio.
 */
function withParsedStyle(row) {
    return { ...row, style: parseJsonColumn(row.style) };
}

/**
 * Dá a TODA linha da trilha o formato novo, inclusive às antigas.
 *
 * Até 18/09/2026 o `snapshot` era só o array de itens; desde então é
 * `{ items, layout, style }`. Converter aqui é o que impede a resposta HTTP de
 * sair com duas formas diferentes conforme a idade do registro — o painel
 * precisaria adivinhar qual veio, e adivinharia errado no dia da virada.
 *
 * Registro antigo não tem como saber o layout nem o estilo daquele momento:
 * vêm nulos, e é honesto que venham.
 */
function shapeSnapshot(snapshot) {
    if (Array.isArray(snapshot)) {
        return { items: snapshot, layout: null, style: null };
    }
    if (snapshot === null || snapshot === undefined) {
        return { items: [], layout: null, style: null };
    }
    return {
        items: Array.isArray(snapshot.items) ? snapshot.items : [],
        layout: snapshot.layout ?? null,
        style: snapshot.style ?? null,
    };
}

class MysqlMieppProductGridRepository extends ProductGridRepositoryPort {
    async list({ active, shop_id, limit, offset }) {
        const [rows, total] = await Promise.all([
            query(SQL_LIST_GRIDS, [active, active, shop_id, shop_id, limit, offset]),
            count(SQL_COUNT_GRIDS, [active, active, shop_id, shop_id]),
        ]);
        return { rows: rows.map(withParsedStyle), total };
    }

    async findById(id) {
        const rows = await query(SQL_GET_GRID_BY_ID, [id]);
        return rows[0] ? withParsedStyle(rows[0]) : null;
    }

    async findItems(gridId) {
        return query(SQL_GET_GRID_ITEMS, [gridId]);
    }

    /**
     * Mídia + grade + itens numa transação.
     *
     * Sem ela, uma falha no INSERT dos itens deixaria uma mídia `processing`
     * órfã na biblioteca, que o editor vê e não consegue explicar.
     */
    async create(payload) {
        return transaction(async (conn) => {
            const [media] = await conn.query(SQL_INSERT_GRID_MEDIA, [
                payload.uuid,
                payload.title,
                payload.duration_seconds,
                payload.created_by,
            ]);

            const [grid] = await conn.query(SQL_INSERT_GRID, [
                media.insertId,
                payload.shop_id,
                payload.grid_columns,
                payload.grid_rows,
                payload.stale_after_minutes,
                JSON.stringify(payload.style),
                payload.active,
                payload.created_by,
            ]);

            for (const item of payload.items) {
                await conn.query(SQL_INSERT_GRID_ITEM, [
                    grid.insertId, item.plu, item.order_index, item.label_override,
                ]);
            }

            return grid.insertId;
        });
    }

    /**
     * Substitui os itens em bloco (DELETE + INSERT), não faz diff.
     *
     * O diff economizaria escritas, mas a grade tem no máximo 36 itens e a
     * ordem é o que mais muda — reconciliar posição item a item é onde nascem
     * os buracos de `order_index`. Trocar tudo dentro da transação mantém a
     * lista sempre coerente.
     */
    async update(id, payload) {
        await transaction(async (conn) => {
            await conn.query(SQL_UPDATE_GRID, [
                payload.shop_id,
                payload.grid_columns,
                payload.grid_rows,
                payload.stale_after_minutes,
                JSON.stringify(payload.style),
                payload.active,
                id,
            ]);

            await conn.query(SQL_UPDATE_GRID_MEDIA_TITLE, [
                payload.title, payload.duration_seconds, payload.media_id,
            ]);

            await conn.query(SQL_DELETE_GRID_ITEMS, [id]);

            for (const item of payload.items) {
                await conn.query(SQL_INSERT_GRID_ITEM, [
                    id, item.plu, item.order_index, item.label_override,
                ]);
            }
        });
    }

    async setBackground(id, fileId) {
        await execute(SQL_UPDATE_GRID_BACKGROUND, [fileId, id]);
    }

    async requestRender(id) {
        await execute(SQL_CLEAR_GRID_DATA_HASH, [id]);
    }

    async countUsage(mediaId) {
        return count(SQL_COUNT_GRID_USAGE, [mediaId]);
    }

    async remove(mediaId) {
        await execute(SQL_DELETE_GRID_MEDIA, [mediaId]);
    }

    async listRenders({ gridId, limit, offset }) {
        const [rows, total] = await Promise.all([
            query(SQL_LIST_GRID_RENDERS, [gridId, limit, offset]),
            count(SQL_COUNT_GRID_RENDERS, [gridId]),
        ]);

        // `snapshot` é coluna JSON: o driver a devolve ora como objeto, ora como
        // string, dependendo da versão do servidor. Normalizar na borda evita
        // que o mesmo campo saia de dois jeitos na resposta HTTP.
        return {
            rows: rows.map(row => ({ ...row, snapshot: shapeSnapshot(parseJsonColumn(row.snapshot)) })),
            total,
        };
    }

    // ─── Ciclo de render ─────────────────────────────────────────────────────

    async listToRender(limit) {
        const rows = await query(SQL_LIST_GRIDS_TO_RENDER, [limit]);
        return rows.map(withParsedStyle);
    }

    async markChecked(id) {
        await execute(SQL_MARK_GRID_CHECKED, [id]);
    }

    async markOffAir(id, reason) {
        await execute(SQL_MARK_GRID_OFF_AIR, [reason, id]);
    }

    async markFailed(id, reason) {
        // O motivo vai para uma coluna VARCHAR(255) e a mensagem de erro do
        // driver passa disso com folga. Truncar aqui evita que o registro do
        // erro vire um erro (1406, "data too long") que apagaria a única pista.
        await execute(SQL_MARK_GRID_FAILED, [String(reason).slice(0, 255), id]);
    }

    async markRendered(id, dataHash) {
        await execute(SQL_MARK_GRID_RENDERED, [dataHash, id]);
    }

    async setMediaFile(mediaId, stored) {
        await execute(SQL_SET_GRID_MEDIA_FILE, [
            // `miepp_media.file_id` é VARCHAR (guarda id de `_files` OU uma URL
            // externa quando o tipo é `weburl`) — vai como string de propósito.
            String(stored.file_id),
            stored.mime_type,
            stored.size_bytes,
            stored.checksum,
            mediaId,
        ]);
    }

    async setMediaStatus(mediaId, status) {
        await execute(SQL_SET_GRID_MEDIA_STATUS, [status, mediaId]);
    }

    async insertRender({ gridId, dataHash, fileId, checksum, snapshot }) {
        await execute(SQL_INSERT_GRID_RENDER, [
            gridId, dataHash, fileId, checksum, JSON.stringify(snapshot),
        ]);
    }
}

module.exports = { MysqlMieppProductGridRepository };
