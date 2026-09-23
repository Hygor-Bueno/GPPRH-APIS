/**
 * @fileoverview Casos de uso dos relatórios de exibição (proof-of-play) lidos
 * pelo painel.
 *
 * A ESCRITA não está aqui: quem grava é o dispositivo, e o ingest mora em
 * `device/miepp-device.use-cases` junto com o heartbeat e o ACK de comando —
 * mesma zona de autenticação, mesmo dono. Este módulo só lê.
 *
 * @module modules/global/application/miepp/play/miepp-play.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { normalizePagination, paginated } = require('../../../domain/miepp/pagination.rules');
const { normalizeRange } = require('../../../domain/miepp/play/play-range.rules');
const {
    shapeMediaRow,
    shapeLocationRow,
    shapePlayerRow,
    shapeDayRow,
    shapeTotals,
} = require('../../../domain/miepp/play/play-report.shaper');

/** @private Filtro numérico opcional vindo da query string. */
function optionalId(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

class MieppPlayUseCases {
    /**
     * @param {object} deps
     * @param {import('../ports/miepp-play-repository.port').MieppPlayRepositoryPort} deps.repository
     * @param {import('../media/ports/media-repository.port').MediaRepositoryPort} deps.mediaRepository
     *        Só para o cabeçalho do relatório de uma mídia (título e tipo
     *        atuais). O histórico NÃO depende dele: mídia apagada continua
     *        listada pelo snapshot do acumulado.
     * @param {import('../ports/miepp-player-repository.port').MieppPlayerRepositoryPort} deps.playerRepository
     *        Para recusar com 404 a evidência de uma tela que não existe.
     */
    constructor({ repository, mediaRepository, playerRepository }) {
        this.repository = repository;
        this.mediaRepository = mediaRepository;
        this.playerRepository = playerRepository;
    }

    /**
     * Ranking do período: uma linha por mídia, da mais exibida para a menos.
     *
     * Responde a pergunta que originou o módulo ("quantas vezes cada mídia já
     * foi exibida"), e os filtros `location_id` / `player_id` respondem a
     * segunda metade dela sem sair da mesma rota: passando `location_id`, a
     * contagem é só do que aquele local exibiu.
     *
     * @param {object} query - `{ from, to, media_id, location_id, player_id, page, limit }`
     */
    async listMediaPlays(query = {}) {
        const range = normalizeRange(query);
        const pagination = normalizePagination(query);

        const { rows, total } = await this.repository.listMediaTotals({
            from: range.from,
            to: range.to,
            mediaId: optionalId(query.media_id),
            locationId: optionalId(query.location_id),
            playerId: optionalId(query.player_id),
            ...pagination,
        });

        return {
            range,
            ...paginated(rows.map(shapeMediaRow), total, pagination),
        };
    }

    /**
     * Relatório de UMA mídia, aberto por local, por tela e por dia.
     *
     * As três quebras vêm na MESMA resposta em vez de três rotas com
     * `?group_by=`: quem abre essa tela quer as três ao mesmo tempo, e três
     * requisições sobre a mesma janela de datas dariam três oportunidades de o
     * período divergir entre os painéis.
     *
     * @param {number} mediaId
     * @param {object} query - `{ from, to }`
     */
    async mediaPlayReport(mediaId, query = {}) {
        const id = optionalId(mediaId);
        if (id === null) throw new AppError('Id de mídia inválido.', 400);

        const range = normalizeRange(query);
        const filters = { mediaId: id, from: range.from, to: range.to };

        const [media, totals] = await Promise.all([
            this.mediaRepository.findById(id),
            this.repository.findMediaTotals(filters),
        ]);

        // Nem cadastro nem histórico: aí a mídia realmente não existe. Só com
        // histórico (mídia apagada depois de ter rodado) o relatório continua
        // válido e é entregue — é para isso que o `media_title` é snapshot.
        if (!media && !totals) {
            throw new AppError('Mídia não encontrada e sem histórico de exibição.', 404);
        }

        const [byLocation, byPlayer, byDay] = await Promise.all([
            this.repository.listLocationsForMedia(filters),
            this.repository.listPlayersForMedia(filters),
            this.repository.listDaysForMedia(filters),
        ]);

        return {
            media: {
                id,
                uuid: media?.uuid ?? null,
                title: media?.title ?? totals?.media_title ?? null,
                type: media?.type ?? null,
                // O painel usa isto para marcar a linha como histórica em vez
                // de oferecer um link que daria 404.
                exists: Boolean(media),
            },
            range,
            totals: shapeTotals(totals),
            by_location: byLocation.map(shapeLocationRow),
            by_player: byPlayer.map(shapePlayerRow),
            by_day: byDay.map(shapeDayRow),
        };
    }

    /**
     * Exibições CRUAS de uma tela — a evidência de "o que essa tela tocou às
     * 14h03".
     *
     * Lê o evento cru, que tem retenção curta (~90 dias, ver
     * `miepp-play-log.sql`). Uma janela anterior à purga volta vazia sem erro, e
     * isso é o esperado: o acumulado é que responde pelo histórico longo.
     *
     * @param {number} playerId
     * @param {object} query - `{ from, to, media_id, page, limit }`
     */
    async listPlayerPlays(playerId, query = {}) {
        const id = optionalId(playerId);
        if (id === null) throw new AppError('Id de player inválido.', 400);

        const player = await this.playerRepository.findById(id);
        if (!player) throw new AppError('Player não encontrado.', 404);

        const range = normalizeRange(query);
        const pagination = normalizePagination(query);

        const { rows, total } = await this.repository.listPlaysForPlayer({
            playerId: id,
            from: range.from,
            to: range.to,
            mediaId: optionalId(query.media_id),
            ...pagination,
        });

        const items = rows.map((row) => ({
            id: Number(row.id),
            event_uuid: row.event_uuid,
            media_id: Number(row.media_id),
            media_uuid: row.media_uuid ?? null,
            title: row.current_title ?? row.media_title ?? null,
            media_exists: Boolean(row.media_uuid),
            location_id: row.location_id === null ? null : Number(row.location_id),
            location_name: row.location_name ?? null,
            playlist_id: row.playlist_id === null ? null : Number(row.playlist_id),
            schedule_id: row.schedule_id === null ? null : Number(row.schedule_id),
            started_at: row.started_at,
            seconds_on_screen: Math.round(Number(row.duration_ms || 0) / 1000),
            completed: Number(row.completed) === 1,
            reported_at: row.reported_at,
        }));

        return {
            player: { id: player.id, name: player.name },
            range,
            ...paginated(items, total, pagination),
        };
    }
}

module.exports = { MieppPlayUseCases };
