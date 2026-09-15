/**
 * @fileoverview Casos de uso de playlists e seus itens.
 *
 * @module modules/global/application/miepp/playlist/miepp-playlist.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { normalizePagination, optionalFlag, paginated } = require('../../../domain/miepp/pagination.rules');

class MieppPlaylistUseCases {
    /**
     * @param {object} deps
     * @param {import('../ports/miepp-playlist-repository.port').MieppPlaylistRepositoryPort} deps.repository
     * @param {import('../media/ports/media-repository.port').MediaRepositoryPort} deps.mediaRepository
     */
    constructor({ repository, mediaRepository }) {
        this.repository = repository;
        this.mediaRepository = mediaRepository;
    }

    /** @private */
    async _requirePlaylist(id) {
        const playlist = await this.repository.findById(id);
        if (!playlist) throw new AppError('Playlist não encontrada.', 404);
        return playlist;
    }

    async list(query = {}) {
        const pagination = normalizePagination(query);
        const { rows, total } = await this.repository.list({
            ...pagination,
            active: optionalFlag(query.active),
        });
        return paginated(rows, total, pagination);
    }

    async getById(id) {
        const playlist = await this._requirePlaylist(id);
        const items = await this.repository.findItems(id);
        return { ...playlist, items };
    }

    async create(payload, actor) {
        const id = await this.repository.create({
            name: payload.name,
            description: payload.description ?? null,
            active: payload.active === undefined ? 1 : Number(payload.active),
            created_by: actor?.id ?? null,
        });
        return this.repository.findById(id);
    }

    async update(id, payload) {
        const current = await this._requirePlaylist(id);

        await this.repository.update(id, {
            name: payload.name ?? current.name,
            description: payload.description === undefined ? current.description : payload.description,
            active: payload.active === undefined ? current.active : Number(payload.active),
        });

        return this.repository.findById(id);
    }

    /**
     * Remoção com guarda de uso.
     *
     * `fk_miepp_schedules_playlist` é ON DELETE CASCADE: apagar a playlist
     * levaria junto todos os agendamentos que a usam, e as telas simplesmente
     * parariam de receber conteúdo sem nada indicando o porquê.
     */
    async remove(id) {
        await this._requirePlaylist(id);

        const usage = await this.repository.countScheduleUsage(id);
        if (usage > 0) {
            throw new AppError(
                `Esta playlist está em ${usage} agendamento(s). Remova os agendamentos antes de excluí-la.`,
                409
            );
        }

        await this.repository.remove(id);
        return { id: Number(id) };
    }

    // ─── Itens ──────────────────────────────────────────────────────────────

    async listItems(playlistId) {
        await this._requirePlaylist(playlistId);
        return this.repository.findItems(playlistId);
    }

    async addItem(playlistId, payload) {
        await this._requirePlaylist(playlistId);

        const media = await this.mediaRepository.findById(payload.media_id);
        if (!media) throw new AppError('Mídia não encontrada.', 404);

        const itemId = await this.repository.addItem(playlistId, {
            media_id: media.id,
            duration_override: payload.duration_override ?? null,
            transition: payload.transition,
        });

        return { id: itemId, playlist_id: Number(playlistId), media_id: media.id };
    }

    async updateItem(playlistId, itemId, payload) {
        await this._requirePlaylist(playlistId);

        const updated = await this.repository.updateItem(playlistId, itemId, {
            duration_override: payload.duration_override ?? null,
            transition: payload.transition,
        });

        if (!updated) throw new AppError('Item não encontrado nesta playlist.', 404);
        return { id: Number(itemId), playlist_id: Number(playlistId) };
    }

    async removeItem(playlistId, itemId) {
        await this._requirePlaylist(playlistId);

        const removed = await this.repository.removeItem(playlistId, itemId);
        if (!removed) throw new AppError('Item não encontrado nesta playlist.', 404);

        return { id: Number(itemId), playlist_id: Number(playlistId) };
    }

    /**
     * Reordena os itens.
     *
     * Exige a lista **completa** dos ids da playlist, não um subconjunto: a
     * ordem é posicional (`order_index` = índice no array), então aceitar
     * ordenação parcial deixaria os itens de fora com posições duplicadas em
     * relação aos reordenados, e o player passaria a tocar numa ordem que
     * ninguém pediu.
     *
     * @param {number}   playlistId
     * @param {number[]} itemIds - ordem final, completa.
     */
    async reorderItems(playlistId, itemIds) {
        await this._requirePlaylist(playlistId);

        const requested = itemIds.map(Number);
        const unique = new Set(requested);

        if (unique.size !== requested.length) {
            throw new AppError('A lista de reordenação tem ids repetidos.', 400);
        }

        const current = (await this.repository.findItemIds(playlistId)).map(Number);
        const currentSet = new Set(current);

        const foreign = requested.filter((id) => !currentSet.has(id));
        if (foreign.length > 0) {
            throw new AppError(
                `Os itens ${foreign.join(', ')} não pertencem a esta playlist.`,
                400
            );
        }

        if (requested.length !== current.length) {
            throw new AppError(
                `A reordenação precisa listar todos os ${current.length} itens da playlist (recebidos ${requested.length}).`,
                400
            );
        }

        await this.repository.reorderItems(playlistId, requested);
        return { playlist_id: Number(playlistId), order: requested };
    }
}

module.exports = { MieppPlaylistUseCases };
