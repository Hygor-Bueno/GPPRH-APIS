/**
 * @fileoverview Casos de uso das rotas consumidas pelo player Android.
 *
 * É a única sub-feature que não roda sob sessão de usuário: quem chama é o
 * dispositivo, autenticado por token próprio (ver
 * `middlewares/meipp-device-auth.middleware.js`).
 *
 * @module modules/global/application/meipp/device/meipp-device.use-cases
 */

const crypto = require('crypto');

const { AppError } = require('../../../../../errors/app.error');
const { StatusLogEvent, CommandStatus } = require('../../../domain/meipp/meipp.enums');
const { resolveActiveSchedule } = require('../../../domain/meipp/schedule/schedule-resolver.rules');
const { shapeItems } = require('../../../domain/meipp/playlist/playlist-item.shaper');

/** Bytes de entropia do token de device. 32 bytes = 64 hex = 256 bits. */
const TOKEN_BYTES = 32;

/** Status de ACK que o device pode declarar. */
const ACK_STATUSES = new Set([CommandStatus.ACKNOWLEDGED, CommandStatus.FAILED]);

class MeippDeviceUseCases {
    /**
     * @param {object} deps
     * @param {import('../ports/meipp-player-repository.port').MeippPlayerRepositoryPort}     deps.playerRepository
     * @param {import('../ports/meipp-schedule-repository.port').MeippScheduleRepositoryPort} deps.scheduleRepository
     * @param {import('../ports/meipp-playlist-repository.port').MeippPlaylistRepositoryPort} deps.playlistRepository
     * @param {object} deps.pairingService - valida o código de pareamento.
     * @param {object} deps.mediaTokenService - assina as URLs de mídia.
     * @param {object} [deps.config] - `{ deviceTokenTtlDays, fallbackPlaylistId }`.
     */
    constructor({
        playerRepository,
        scheduleRepository,
        playlistRepository,
        pairingService,
        mediaTokenService,
        config = {},
    }) {
        this.playerRepository = playerRepository;
        this.scheduleRepository = scheduleRepository;
        this.playlistRepository = playlistRepository;
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
        const playerId = this.pairingService.verify(pairingCode);

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
        const [schedules, groupIds] = await Promise.all([
            this.scheduleRepository.findActiveWithTargets(),
            this.playerRepository.findGroupIds(player.id),
        ]);

        const schedule = resolveActiveSchedule({ schedules, playerId: player.id, groupIds, now });

        const playlistId = schedule
            ? schedule.playlist_id
            : this._fallbackPlaylistId();

        if (!playlistId) {
            // Passo 7 do requisito, modo v1: sem agendamento e sem fallback
            // configurado, devolvemos lista vazia com `keep_cache`. O player
            // mantém o último conteúdo em cache em vez de apagar a tela — uma
            // tela preta na loja é pior do que conteúdo de ontem.
            return {
                schedule: null,
                playlist: null,
                keep_cache: true,
                items: [],
                resolved_at: now.toISOString(),
            };
        }

        const playlist = await this.playlistRepository.findById(playlistId);
        if (!playlist || Number(playlist.active) !== 1) {
            return {
                schedule: null,
                playlist: null,
                keep_cache: true,
                items: [],
                resolved_at: now.toISOString(),
            };
        }

        const rows = await this.playlistRepository.findItems(playlist.id);
        const signUrl = (mediaUuid) => this.mediaTokenService.buildUrl(mediaUuid, player.id);

        return {
            schedule: schedule
                ? { id: schedule.id, name: schedule.name, priority: schedule.priority }
                : { id: null, name: 'fallback', priority: null },
            playlist: { id: playlist.id, name: playlist.name },
            keep_cache: false,
            items: shapeItems(rows, signUrl),
            resolved_at: now.toISOString(),
        };
    }

    /** @private Fallback global da v1. Por player/local é a extensão natural daqui. */
    _fallbackPlaylistId() {
        const configured = Number(this.config.fallbackPlaylistId);
        return Number.isInteger(configured) && configured > 0 ? configured : null;
    }

    /**
     * Recebe o status do player e grava um evento no histórico.
     *
     * @param {object} player - player autenticado.
     * @param {object} body   - `{ app_version, memory, event_type, detail }`.
     * @param {string|null} ip - IP observado pelo Express (não vem do corpo).
     */
    async heartbeat(player, body = {}, ip = null) {
        const eventType = body.event_type || StatusLogEvent.ONLINE;

        await this.playerRepository.registerHeartbeat(player.id, {
            ip,
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
            },
        });

        return { player_id: player.id, received_at: new Date().toISOString() };
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

module.exports = { MeippDeviceUseCases, ACK_STATUSES };
