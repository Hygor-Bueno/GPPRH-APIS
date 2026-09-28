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
const { normalizeOrigin, withOrigin } = require('../../../domain/miepp/media/media-origin.rules');
const { normalizeFolderFilter, normalizeFolderId } = require('../../../domain/miepp/media/media-folder.rules');

/** Tipos que exigem um arquivo enviado; `weburl` aponta para fora. */
const TYPES_REQUIRING_FILE = new Set([MediaType.IMAGE, MediaType.VIDEO, MediaType.HTML]);

/** Teto do mover em lote — o mesmo de uma página cheia da listagem. */
const MAX_MOVE_BATCH = 200;

class MieppMediaUseCases {
    /**
     * @param {object} deps
     * @param {import('./ports/media-repository.port').MediaRepositoryPort} deps.repository
     * @param {object} deps.storage - `MieppMediaStorageService`.
     * @param {import('./ports/media-folder-repository.port').MediaFolderRepositoryPort} [deps.folderRepository]
     *        - para conferir a pasta de destino antes de gravar. Sem ele a FK
     *        ainda recusa, mas a resposta é a do adapter.
     */
    constructor({ repository, storage, folderRepository = null }) {
        this.repository = repository;
        this.storage = storage;
        this.folderRepository = folderRepository;
    }

    /** @private */
    async _requireMedia(id) {
        const media = await this.repository.findById(id);
        if (!media) throw new AppError('Mídia não encontrada.', 404);
        return media;
    }

    /**
     * A pasta de destino, normalizada e conferida. `undefined` = campo ausente,
     * `null` = raiz; nos dois casos não há o que conferir.
     * @private
     */
    async _resolveFolderId(value) {
        const folderId = normalizeFolderId(value);
        if (folderId && this.folderRepository) {
            const folder = await this.folderRepository.findById(folderId);
            if (!folder) throw new AppError('Pasta não encontrada.', 404);
        }
        return folderId;
    }

    /**
     * `?origin=upload|generated` filtra por ORIGEM, e cada linha volta com o
     * campo `origin` resolvido.
     *
     * Sem isso a biblioteca do painel mostra grade e imagem comum como a mesma
     * coisa — as duas são `type: 'image'` —, e quem clica numa grade cai no
     * formulário de mídia, que edita título e duração e não tem como mexer nos
     * produtos. O player já distinguia pelo mesmo campo; era só o painel que
     * não tinha como.
     *
     * `?folder_id=<id>|root` abre uma pasta. Sem o parâmetro a listagem segue
     * devolvendo a biblioteca inteira, como antes das pastas existirem.
     */
    async list(query = {}) {
        const pagination = normalizePagination(query);
        const folder = normalizeFolderFilter(query.folder_id);
        const { rows, total } = await this.repository.list({
            ...pagination,
            type: query.type ?? null,
            status: query.status ?? null,
            origin: normalizeOrigin(query.origin),
            folderMode: folder.mode,
            folderId: folder.folderId,
        });
        return paginated(rows.map(withOrigin), total, pagination);
    }

    async getById(id) {
        return withOrigin(await this._requireMedia(id));
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

        // Antes do upload: pasta inexistente depois de gravar o arquivo deixaria
        // um binário em `_files` sem mídia apontando para ele.
        const folderId = (await this._resolveFolderId(payload.folder_id)) ?? null;

        if (type === MediaType.WEBURL) {
            if (!payload.url) {
                throw new AppError('Mídia do tipo "weburl" exige o campo "url".', 400);
            }

            const created = await this.repository.create({
                uuid: crypto.randomUUID(),
                title: payload.title,
                folder_id: folderId,
                type,
                file_id: payload.url,
                mime_type: null,
                size_bytes: null,
                duration_seconds: Number(payload.duration_seconds ?? 10),
                checksum: null,
                status: MediaStatus.READY,
                uploaded_by: actor?.id ?? null,
            });

            return withOrigin(await this.repository.findById(created.id));
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
            folder_id: folderId,
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

        return withOrigin(await this.repository.findById(created.id));
    }

    /**
     * Só título, duração e status são editáveis — os campos que descrevem o
     * binário mudam apenas por novo upload. Trocar o arquivo de uma mídia já em
     * playlist é cadastrar outra mídia, não editar esta.
     *
     * `folder_id` ausente mantém a pasta; `null` manda para a raiz.
     */
    async update(id, payload) {
        const current = await this._requireMedia(id);
        const folderId = await this._resolveFolderId(payload.folder_id);

        await this.repository.update(id, {
            title: payload.title ?? current.title,
            folder_id: folderId === undefined ? current.folder_id ?? null : folderId,
            duration_seconds: payload.duration_seconds === undefined
                ? current.duration_seconds
                : Number(payload.duration_seconds),
            status: payload.status ?? current.status,
        });

        return withOrigin(await this.repository.findById(id));
    }

    /**
     * Move várias mídias para a mesma pasta de uma vez — o "selecionar e
     * arrastar" do painel. Body: `{ media_ids: [..], folder_id: <id>|null }`.
     *
     * Tudo ou nada: se algum id não existe, nada é movido e a resposta diz
     * quais faltaram. Mover a parte que existe deixaria o usuário achando que
     * a seleção inteira foi, sem ter como descobrir o que ficou para trás.
     *
     * `folder_id` é obrigatório (e `null` = raiz): ausente aqui não tem
     * "manter" que faça sentido, e tratar como raiz tiraria da pasta, em
     * silêncio, tudo o que foi selecionado.
     */
    async moveMany(payload = {}) {
        const rawIds = payload.media_ids;
        if (!Array.isArray(rawIds) || rawIds.length === 0) {
            throw new AppError("O campo 'media_ids' deve ser uma lista com ao menos um id.", 400);
        }
        if (rawIds.length > MAX_MOVE_BATCH) {
            throw new AppError(`No máximo ${MAX_MOVE_BATCH} mídias por vez.`, 400);
        }

        const ids = [...new Set(rawIds.map(Number))];
        if (ids.some((id) => !Number.isInteger(id) || id < 1)) {
            throw new AppError("O campo 'media_ids' deve conter apenas ids numéricos.", 400);
        }

        if (!('folder_id' in payload)) {
            throw new AppError("O campo 'folder_id' é obrigatório (use null para a raiz).", 400);
        }
        const folderId = (await this._resolveFolderId(payload.folder_id)) ?? null;

        const existing = new Set(await this.repository.findExistingIds(ids));
        const missing = ids.filter((id) => !existing.has(id));
        if (missing.length > 0) {
            throw new AppError(`Mídia(s) não encontrada(s): ${missing.join(', ')}. Nada foi movido.`, 404);
        }

        await this.repository.moveToFolder(ids, folderId);
        return { folder_id: folderId, media_ids: ids, moved: ids.length };
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

module.exports = { MieppMediaUseCases, TYPES_REQUIRING_FILE, MAX_MOVE_BATCH };
