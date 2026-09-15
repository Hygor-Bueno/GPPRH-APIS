/**
 * @fileoverview Casos de uso de mídia (`miepp_media`).
 *
 * O binário não mora neste módulo: quem grava, deduplica e valida o arquivo é o
 * sistema `_files` do global, atrás do `MieppMediaStorageService`. Aqui só
 * decidimos *quando* chamá-lo e o que registrar na tabela.
 *
 * @module modules/global/application/miepp/media/miepp-media.use-cases
 */

const crypto = require('crypto');

const { AppError } = require('../../../../../errors/app.error');
const { MediaType, MediaStatus } = require('../../../domain/miepp/miepp.enums');
const { normalizePagination, paginated } = require('../../../domain/miepp/pagination.rules');

/** Tipos que exigem um arquivo enviado; `weburl` aponta para fora. */
const TYPES_REQUIRING_FILE = new Set([MediaType.IMAGE, MediaType.VIDEO, MediaType.HTML]);

class MieppMediaUseCases {
    /**
     * @param {object} deps
     * @param {import('./ports/media-repository.port').MediaRepositoryPort} deps.repository
     * @param {object} deps.storage - `MieppMediaStorageService`.
     */
    constructor({ repository, storage }) {
        this.repository = repository;
        this.storage = storage;
    }

    /** @private */
    async _requireMedia(id) {
        const media = await this.repository.findById(id);
        if (!media) throw new AppError('Mídia não encontrada.', 404);
        return media;
    }

    async list(query = {}) {
        const pagination = normalizePagination(query);
        const { rows, total } = await this.repository.list({
            ...pagination,
            type: query.type ?? null,
            status: query.status ?? null,
        });
        return paginated(rows, total, pagination);
    }

    async getById(id) {
        return this._requireMedia(id);
    }

    /**
     * Cadastra a mídia.
     *
     * Dois caminhos, decididos pelo `type`:
     *  - `weburl` — sem binário; `file_id` guarda a URL externa e o status já
     *    nasce `ready`, porque não há nada a processar.
     *  - demais — exige `file` no multipart. O arquivo vai para `_files` ANTES
     *    do INSERT: se a gravação falhar, não fica linha órfã apontando para um
     *    arquivo que não existe.
     *
     * @param {object} payload - corpo validado.
     * @param {object|undefined} file - `req.file` do multer.
     * @param {object} actor - usuário da sessão (`req.user`); o id vai em `uploaded_by`.
     */
    async create(payload, file, actor) {
        const type = payload.type;

        if (type === MediaType.WEBURL) {
            if (!payload.url) {
                throw new AppError('Mídia do tipo "weburl" exige o campo "url".', 400);
            }

            const created = await this.repository.create({
                uuid: crypto.randomUUID(),
                title: payload.title,
                type,
                file_id: payload.url,
                mime_type: null,
                size_bytes: null,
                duration_seconds: Number(payload.duration_seconds ?? 10),
                checksum: null,
                status: MediaStatus.READY,
                uploaded_by: actor?.id ?? null,
            });

            return this.repository.findById(created.id);
        }

        if (!TYPES_REQUIRING_FILE.has(type)) {
            throw new AppError(`Tipo de mídia não suportado: "${type}".`, 400);
        }

        if (!file) {
            throw new AppError(`Mídia do tipo "${type}" exige o envio de um arquivo.`, 400);
        }

        const stored = await this.storage.save(file, actor?.id ?? null);

        const created = await this.repository.create({
            uuid: crypto.randomUUID(),
            title: payload.title,
            type,
            file_id: String(stored.file_id),
            mime_type: stored.mime_type,
            size_bytes: stored.size_bytes,
            duration_seconds: Number(payload.duration_seconds ?? 10),
            checksum: stored.checksum,
            // Vídeo pode entrar na fila de transcodificação do `_files`; até o
            // worker terminar, o player não deve receber o item. Ver
            // `isPlayable` em `playlist-item.shaper`.
            status: stored.pending_transcode ? MediaStatus.PROCESSING : MediaStatus.READY,
            uploaded_by: actor?.id ?? null,
        });

        return this.repository.findById(created.id);
    }

    /**
     * Só título, duração e status são editáveis — os campos que descrevem o
     * binário mudam apenas por novo upload. Trocar o arquivo de uma mídia já em
     * playlist é cadastrar outra mídia, não editar esta.
     */
    async update(id, payload) {
        const current = await this._requireMedia(id);

        await this.repository.update(id, {
            title: payload.title ?? current.title,
            duration_seconds: payload.duration_seconds === undefined
                ? current.duration_seconds
                : Number(payload.duration_seconds),
            status: payload.status ?? current.status,
        });

        return this.repository.findById(id);
    }

    /**
     * Remoção com guarda de uso.
     *
     * `miepp_playlist_items` é ON DELETE CASCADE: sem esta checagem, apagar uma
     * mídia arrancaria o item de toda playlist que a usa, sem aviso e sem
     * rastro visível para quem montou a programação.
     *
     * O binário em `_files` NÃO é apagado: aquele storage deduplica por hash, e
     * o mesmo arquivo pode estar referenciado por outro módulo.
     */
    async remove(id) {
        await this._requireMedia(id);

        const usage = await this.repository.countPlaylistUsage(id);
        if (usage > 0) {
            throw new AppError(
                `Esta mídia está em ${usage} item(ns) de playlist. Remova-a das playlists antes de excluir.`,
                409
            );
        }

        await this.repository.remove(id);
        return { id: Number(id) };
    }
}

module.exports = { MieppMediaUseCases, TYPES_REQUIRING_FILE };
