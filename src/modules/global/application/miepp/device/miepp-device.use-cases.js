/**
 * @fileoverview Casos de uso das rotas consumidas pelo player Android.
 *
 * É a única sub-feature que não roda sob sessão de usuário: quem chama é o
 * dispositivo, autenticado por token próprio (ver
 * `middlewares/miepp-device-auth.middleware.js`).
 *
 * @module modules/global/application/miepp/device/miepp-device.use-cases
 */

const crypto = require('crypto');

const { AppError } = require('../../../../../errors/app.error');
const { StatusLogEvent, CommandStatus } = require('../../../domain/miepp/miepp.enums');
const { resolveActiveSchedule } = require('../../../domain/miepp/schedule/schedule-resolver.rules');
const {
    RejectReason,
    findBatchError,
    normalizeBatch,
} = require('../../../domain/miepp/play/play-event.rules');
const {
    MediaOrigin,
    isPlayable,
    resolveOrigin,
    shapeMedia,
    shapeFallbackItem,
    shapeItems,
} = require('../../../domain/miepp/playlist/playlist-item.shaper');

/** Bytes de entropia do token de device. 32 bytes = 64 hex = 256 bits. */
const TOKEN_BYTES = 32;

/** Status de ACK que o device pode declarar. */
const ACK_STATUSES = new Set([CommandStatus.ACKNOWLEDGED, CommandStatus.FAILED]);

class MieppDeviceUseCases {
    /**
     * @param {object} deps
     * @param {import('../ports/miepp-player-repository.port').MieppPlayerRepositoryPort}     deps.playerRepository
     * @param {import('../ports/miepp-schedule-repository.port').MieppScheduleRepositoryPort} deps.scheduleRepository
     * @param {import('../ports/miepp-playlist-repository.port').MieppPlaylistRepositoryPort} deps.playlistRepository
     * @param {import('../media/ports/media-repository.port').MediaRepositoryPort} [deps.mediaRepository]
     *        Só para resolver a mídia de reserva. Opcional: sem ele a resposta
     *        sai com `fallback: null`, que é o comportamento de quem não
     *        configurou reserva nenhuma.
     * @param {import('../ports/miepp-play-repository.port').MieppPlayRepositoryPort} [deps.playRepository]
     *        Registro de exibições (proof-of-play). Opcional pelo mesmo motivo
     *        do `mediaRepository`: sem ele, apenas a rota `POST /device/plays`
     *        deixa de funcionar — playlist, heartbeat e comandos, que são o que
     *        mantém a parede no ar, continuam de pé.
     * @param {object} deps.pairingService - valida o código de pareamento.
     * @param {object} deps.mediaTokenService - assina as URLs de mídia.
     * @param {object} [deps.config] - `{ deviceTokenTtlDays, fallbackPlaylistId, fallbackMediaId }`.
     */
    constructor({
        playerRepository,
        scheduleRepository,
        playlistRepository,
        mediaRepository = null,
        playRepository = null,
        pairingService,
        mediaTokenService,
        config = {},
    }) {
        this.playerRepository = playerRepository;
        this.scheduleRepository = scheduleRepository;
        this.playlistRepository = playlistRepository;
        this.mediaRepository = mediaRepository;
        this.playRepository = playRepository;
        this.pairingService = pairingService;
        this.mediaTokenService = mediaTokenService;
        this.config = config;
    }

    /**
     * Troca o código de pareamento pelo token do device.
     *
     * É a única rota de device sem token prévio. O token é devolvido em texto
     * puro **uma única vez**: o banco guarda só o SHA-256, então nem o painel
     * nem o suporte conseguem recuperá-lo depois — perder o token significa
     * parear de novo.
     *
     * Parear revoga os tokens anteriores do mesmo player. É o comportamento
     * certo para troca de equipamento: a caixa antiga para de baixar conteúdo
     * assim que a nova entra no ar.
     *
     * @param {string} pairingCode
     * @returns {Promise<{token: string, player: object, expires_at: string|null}>}
     */
    async pair(pairingCode) {
        const playerId = await this.pairingService.verify(pairingCode);

        const player = await this.playerRepository.findById(playerId);
        if (!player || Number(player.active) !== 1) {
            // Mesma mensagem de código inválido: o device não precisa saber
            // distinguir "código errado" de "player desativado", e a diferença
            // só serviria para sondar a base.
            throw new AppError('Código de pareamento inválido ou expirado.', 401);
        }

        const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        const ttlDays = Number(this.config.deviceTokenTtlDays);
        const expiresAt = Number.isFinite(ttlDays) && ttlDays > 0
            ? new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
            : null;

        await this.playerRepository.replaceDeviceToken(player.id, tokenHash, expiresAt);

        await this.playerRepository.registerHeartbeat(player.id, {
            ip: null,
            appVersion: null,
            eventType: StatusLogEvent.ONLINE,
            detail: { event: 'paired' },
        });

        return {
            token,
            expires_at: expiresAt ? expiresAt.toISOString() : null,
            player: {
                id: player.id,
                uuid: player.uuid,
                name: player.name,
                orientation: player.orientation,
                resolution: player.resolution,
            },
        };
    }

    /**
     * Resolve e devolve a playlist que este player deve tocar AGORA.
     *
     * A decisão em si é do domínio (`schedule-resolver.rules`); aqui só
     * buscamos os insumos, tratamos o caso "nenhum agendamento casou" e
     * montamos o JSON com as URLs já assinadas.
     *
     * @param {object} player - player autenticado (vem do middleware).
     * @param {Date}   [now]  - injetável para teste.
     */
    async getPlaylist(player, now = new Date()) {
        const signUrl = (mediaUuid) => this.mediaTokenService.buildUrl(mediaUuid, player.id);

        // A reserva é resolvida em toda resposta, inclusive nas de lista vazia:
        // o player precisa dela em cache ANTES de a rede cair, senão ela falta
        // exatamente na hora em que serve para alguma coisa.
        const [schedules, groupIds, fallbackRow] = await Promise.all([
            this.scheduleRepository.findActiveWithTargets(),
            this.playerRepository.findGroupIds(player.id),
            this._findFallbackMediaRow(),
        ]);

        const fallback = fallbackRow ? { media: shapeMedia(fallbackRow, signUrl) } : null;

        const schedule = resolveActiveSchedule({ schedules, playerId: player.id, groupIds, now });

        const playlistId = schedule
            ? schedule.playlist_id
            : this._fallbackPlaylistId();

        // Passo 7 do requisito, modo v1: sem agendamento e sem playlist de
        // fallback configurada, devolvemos lista vazia com `keep_cache`. O
        // player mantém o último conteúdo em cache em vez de apagar a tela —
        // uma tela preta na loja é pior do que conteúdo de ontem.
        const nothingScheduled = {
            schedule: null,
            playlist: null,
            keep_cache: true,
            fallback,
            items: [],
            resolved_at: now.toISOString(),
        };

        if (!playlistId) return nothingScheduled;

        const playlist = await this.playlistRepository.findById(playlistId);
        if (!playlist || Number(playlist.active) !== 1) return nothingScheduled;

        const rows = await this.playlistRepository.findItems(playlist.id);
        const items = shapeItems(rows, signUrl, { hasFallback: Boolean(fallbackRow) });

        // Sobrou lista vazia e existe reserva: ela entra como item comum. É o
        // que protege as telas com APK antiga, que não conhecem `fallback` e
        // apagariam a parede ao receber `items: []`.
        if (items.length === 0 && fallbackRow) {
            items.push(shapeFallbackItem(fallbackRow, signUrl));
        }

        return {
            schedule: schedule
                ? { id: schedule.id, name: schedule.name, priority: schedule.priority }
                : { id: null, name: 'fallback', priority: null },
            playlist: { id: playlist.id, name: playlist.name },
            keep_cache: false,
            fallback,
            items,
            resolved_at: now.toISOString(),
        };
    }

    /** @private Fallback global da v1. Por player/local é a extensão natural daqui. */
    _fallbackPlaylistId() {
        const configured = Number(this.config.fallbackPlaylistId);
        return Number.isInteger(configured) && configured > 0 ? configured : null;
    }

    /**
     * @private Linha da mídia de reserva, ou `null`.
     *
     * Recusa em silêncio três coisas, e todas as três são configuração errada,
     * não estado do dia a dia:
     *
     *  - id ausente ou inválido → não há reserva, que é o padrão;
     *  - mídia que não existe ou não está `ready` → não dá para exibir;
     *  - mídia que é GRADE → grade mostra preço, e preço não pode ser o
     *    conteúdo perene que substitui preço vencido. Aceitar seria trocar uma
     *    grade vencida por outra.
     *
     * Silêncio porque isto roda a cada poll de cada tela: registrar aqui
     * inundaria o log. O sintoma é visível na resposta — `fallback` vem `null`.
     */
    async _findFallbackMediaRow() {
        const configured = Number(this.config.fallbackMediaId);
        if (!Number.isInteger(configured) || configured <= 0) return null;
        if (!this.mediaRepository) return null;

        const row = await this.mediaRepository.findForDevice(configured);
        if (!row || !isPlayable(row)) return null;
        if (resolveOrigin(row) === MediaOrigin.GENERATED) return null;

        return row;
    }

    /**
     * Recebe o status do player e grava um evento no histórico.
     *
     * @param {object} player - player autenticado.
     * @param {object} body   - `{ app_version, memory, event_type, detail }`.
     * @param {string|null} ip - IP observado pelo Express (não vem do corpo).
     */
    async heartbeat(player, body = {}, observedIp = null) {
        const eventType = body.event_type || StatusLogEvent.ONLINE;

        await this.playerRepository.registerHeartbeat(player.id, {
            // O IP de LAN vence o observado quando o app o informa: é ele que
            // localiza a tela na rede da loja. O observado é o de saída e fica
            // igual para todas as telas do mesmo lugar.
            ip: body.local_ip || observedIp,
            appVersion: body.app_version ?? null,
            eventType,
            // O detalhe é livre (JSON), mas só passamos campos conhecidos: o
            // corpo vem do dispositivo e não deve entrar cru no banco.
            detail: {
                app_version: body.app_version ?? null,
                memory_used_mb: body.memory_used_mb ?? null,
                memory_total_mb: body.memory_total_mb ?? null,
                storage_free_mb: body.storage_free_mb ?? null,
                message: body.message ?? null,
                // Os dois lado a lado, para conferência: o que o app declarou
                // e o que o servidor observou.
                local_ip: body.local_ip ?? null,
                observed_ip: observedIp,
            },
        });

        return { player_id: player.id, received_at: new Date().toISOString() };
    }

    /**
     * Registra as exibições que a tela já fez (proof-of-play).
     *
     * É a PRIMEIRA rota em que o dispositivo escreve conteúdo — até aqui ele
     * lia playlist e confirmava comando. O dado só existe porque o player o
     * informa: nada no servidor sabe o que apareceu na parede (a entrega do
     * binário não serve, porque o player cacheia por checksum e baixa uma vez
     * o que toca centenas).
     *
     * ─── O contrato com o app, e por que ele é assim ────────────────────────
     *
     * Resposta 2xx significa que o lote INTEIRO foi processado: todo evento
     * enviado terminou em `accepted`, `duplicated` ou `rejected`, e os três são
     * estados finais. O app pode limpar a fila local do lote sem reter nada.
     * Só erro 5xx pede reenvio.
     *
     * Isso é o que impede o pior modo de falha deste tipo de rota: um evento
     * ruim no meio do lote derrubar o lote todo, o app reenviar para sempre e a
     * tela nunca mais reportar nada. Por isso a crítica é por evento (ver
     * `play-event.rules`) e o motivo da recusa volta como código estável.
     *
     * Reenvio não soma duas vezes — a idempotência é pela UNIQUE de
     * `event_uuid`, e a chave é gerada NO DISPOSITIVO, porque só ele sabe que
     * dois envios são a mesma exibição.
     *
     * @param {object} player - player autenticado (vem do middleware).
     * @param {object} body   - `{ plays: [{ event_uuid, media_uuid, started_at, duration_ms, completed, playlist_id, schedule_id }] }`
     * @param {Date}   [now]  - injetável para teste.
     */
    async recordPlays(player, body = {}, now = new Date()) {
        if (!this.playRepository) {
            throw new AppError('Registro de exibições indisponível.', 503);
        }

        // Os dois únicos casos que invalidam a REQUISIÇÃO: sem lista e lista
        // acima do teto. Tudo mais é recusa por evento.
        const batchError = findBatchError(body.plays);
        if (batchError) throw new AppError(batchError, 400);

        const { plays, rejected } = normalizeBatch(body.plays, now);

        // O player conhece a mídia pelo UUID (é o que `GET /device/playlist`
        // entrega), nunca pelo id. Resolver aqui em vez de aceitar um id vindo
        // do dispositivo mantém a regra da casa: o corpo do device não escolhe
        // chave primária.
        const uuids = [...new Set(plays.map((play) => play.media_uuid))];
        const found = await this.playRepository.resolveMediaByUuids(uuids);
        const byUuid = new Map(found.map((row) => [row.uuid, row]));

        const resolved = [];
        for (const play of plays) {
            const media = byUuid.get(play.media_uuid);

            // Mídia que não existe mais é recusa, não erro: a tela pode ter
            // ficado dias sem rede e a campanha já ter sido apagada no painel.
            // Nomeando a recusa, o app tira o evento da fila em vez de tentar
            // para sempre.
            if (!media) {
                rejected.push({ event_uuid: play.event_uuid, reason: RejectReason.UNKNOWN_MEDIA });
                continue;
            }

            resolved.push({
                ...play,
                media_id: Number(media.id),
                // Snapshot do título: o DELETE de mídia é físico, e sem isto o
                // relatório histórico ficaria com a linha em branco.
                media_title: media.title ?? null,
            });
        }

        const { accepted, duplicated } = await this.playRepository.recordPlays({
            playerId: player.id,
            // Local da tela NO MOMENTO do registro. Vira snapshot e não é
            // recalculado na leitura: a tela muda de lugar, e sem o snapshot a
            // audiência histórica migraria de local junto com o equipamento.
            locationId: player.location_id ?? null,
            plays: resolved,
        });

        return {
            received: Array.isArray(body.plays) ? body.plays.length : 0,
            accepted: accepted.length,
            duplicated: duplicated.length,
            rejected,
            processed_at: now.toISOString(),
        };
    }

    /**
     * Entrega os comandos pendentes e já os marca como `sent`.
     *
     * Ler e marcar na mesma transação evita a entrega repetida quando o player
     * chama de novo antes de confirmar. A contrapartida é conhecida: se a
     * resposta se perder no caminho, o comando fica em `sent` e não volta para
     * `pending` sozinho — quem reenvia é o painel.
     */
    async pendingCommands(player) {
        const commands = await this.playerRepository.claimPendingCommands(player.id);

        return commands.map((command) => ({
            id: command.id,
            command_type: command.command_type,
            payload: command.payload ?? null,
            created_at: command.created_at,
        }));
    }

    /**
     * ACK de um comando.
     *
     * O `player.id` entra no WHERE do UPDATE (ver `SQL_ACK_COMMAND`): um device
     * não pode confirmar comando de outro, mesmo acertando o id.
     */
    async ackCommand(player, commandId, status) {
        if (!ACK_STATUSES.has(status)) {
            throw new AppError(
                `Status inválido para ACK: "${status}". Use "acknowledged" ou "failed".`,
                400
            );
        }

        const updated = await this.playerRepository.ackCommand(commandId, player.id, status);
        if (!updated) {
            throw new AppError('Comando não encontrado para este player ou já finalizado.', 404);
        }

        return { id: Number(commandId), status };
    }
}

module.exports = { MieppDeviceUseCases, ACK_STATUSES };
