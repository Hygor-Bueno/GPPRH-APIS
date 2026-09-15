/**
 * @fileoverview Adapter MySQL de `miepp_playlists` e `miepp_playlist_items`.
 *
 * @module modules/global/infrastructure/miepp/mysql-miepp-playlist.repository
 */

const { MieppPlaylistRepositoryPort } = require('../../application/miepp/ports/miepp-playlist-repository.port');
const { query, execute, count, transaction } = require('./miepp-mysql.helper');
const {
    SQL_LIST_PLAYLISTS,
    SQL_COUNT_PLAYLISTS,
    SQL_GET_PLAYLIST_BY_ID,
    SQL_INSERT_PLAYLIST,
    SQL_UPDATE_PLAYLIST,
    SQL_DELETE_PLAYLIST,
    SQL_COUNT_PLAYLIST_USAGE,
    SQL_GET_PLAYLIST_ITEMS,
    SQL_NEXT_ITEM_ORDER,
    SQL_INSERT_PLAYLIST_ITEM,
    SQL_UPDATE_PLAYLIST_ITEM,
    SQL_DELETE_PLAYLIST_ITEM,
    SQL_SET_ITEM_ORDER,
    SQL_GET_PLAYLIST_ITEM_IDS,
} = require('../../repositories/mysql/miepp-playlist.queries');

class MysqlMieppPlaylistRepository extends MieppPlaylistRepositoryPort {
    async list({ active, limit, offset }) {
        const [rows, total] = await Promise.all([
            query(SQL_LIST_PLAYLISTS, [active, active, limit, offset]),
            count(SQL_COUNT_PLAYLISTS, [active, active]),
        ]);
        return { rows, total };
    }

    async findById(id) {
        const rows = await query(SQL_GET_PLAYLIST_BY_ID, [id]);
        return rows[0] || null;
    }

    async create(payload) {
        const result = await execute(SQL_INSERT_PLAYLIST, [
            payload.name, payload.description, payload.active, payload.created_by,
        ]);
        return result.insertId;
    }

    async update(id, payload) {
        await execute(SQL_UPDATE_PLAYLIST, [
            payload.name, payload.description, payload.active, id,
        ]);
    }

    async remove(id) {
        await execute(SQL_DELETE_PLAYLIST, [id]);
    }

    async countScheduleUsage(id) {
        return count(SQL_COUNT_PLAYLIST_USAGE, [id]);
    }

    async findItems(playlistId) {
        return query(SQL_GET_PLAYLIST_ITEMS, [playlistId]);
    }

    /**
     * Ler a próxima posição e inserir precisam ser atômicos: duas inclusões
     * simultâneas na mesma playlist leriam o mesmo `next_order` e os dois itens
     * ficariam empatados na ordem.
     */
    async addItem(playlistId, payload) {
        return transaction(async (conn) => {
            const [orderRows] = await conn.query(SQL_NEXT_ITEM_ORDER, [playlistId]);
            const nextOrder = Number(orderRows[0]?.next_order ?? 0);

            const [result] = await conn.query(SQL_INSERT_PLAYLIST_ITEM, [
                playlistId, payload.media_id, nextOrder,
                payload.duration_override, payload.transition,
            ]);

            return result.insertId;
        });
    }

    async updateItem(playlistId, itemId, payload) {
        const result = await execute(SQL_UPDATE_PLAYLIST_ITEM, [
            payload.duration_override, payload.transition, itemId, playlistId,
        ]);
        return Number(result.affectedRows || 0) > 0;
    }

    async removeItem(playlistId, itemId) {
        const result = await execute(SQL_DELETE_PLAYLIST_ITEM, [itemId, playlistId]);
        return Number(result.affectedRows || 0) > 0;
    }

    async findItemIds(playlistId) {
        const rows = await query(SQL_GET_PLAYLIST_ITEM_IDS, [playlistId]);
        return rows.map((row) => Number(row.id));
    }

    /**
     * Reordenação inteira numa transação: se um dos UPDATEs falhasse no meio, a
     * playlist ficaria com metade da ordem nova e metade da antiga — e o player
     * tocaria numa sequência que não existe em nenhuma das duas.
     */
    async reorderItems(playlistId, orderedItemIds) {
        await transaction(async (conn) => {
            for (let index = 0; index < orderedItemIds.length; index += 1) {
                await conn.query(SQL_SET_ITEM_ORDER, [index, orderedItemIds[index], playlistId]);
            }
        });
    }
}

module.exports = { MysqlMieppPlaylistRepository };
