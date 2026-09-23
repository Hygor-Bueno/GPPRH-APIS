/**
 * @fileoverview Testes do proof-of-play: o ingest do dispositivo e os
 * relatórios do painel.
 *
 * Os dois estão no mesmo arquivo porque testam as duas pontas do MESMO
 * contrato — o que o player grava é o que o relatório lê, e um teste que
 * mudasse só uma ponta não pegaria a divergência.
 *
 * Usa fakes (subclasses das portas com `jest.fn()`), nunca o banco.
 */

const { MieppDeviceUseCases } = require('../device/miepp-device.use-cases');
const { MieppPlayUseCases } = require('../play/miepp-play.use-cases');
const { MieppPlayRepositoryPort } = require('../ports/miepp-play-repository.port');
const { MieppPlayerRepositoryPort } = require('../ports/miepp-player-repository.port');
const { MieppScheduleRepositoryPort } = require('../ports/miepp-schedule-repository.port');
const { MieppPlaylistRepositoryPort } = require('../ports/miepp-playlist-repository.port');
const { MediaRepositoryPort } = require('../media/ports/media-repository.port');
const { RejectReason } = require('../../../domain/miepp/play/play-event.rules');

const AGORA = new Date(2026, 8, 21, 14, 0, 0);

/** Tela do Caixa 1, na Loja Centro (local 3). */
const DEVICE = { id: 1, uuid: 'uuid-player', name: 'Tela Caixa 1', location_id: 3 };

const MIDIA = { id: 5, uuid: 'media-uuid-0001', title: 'Campanha Setembro' };

class FakePlayRepository extends MieppPlayRepositoryPort {
    constructor({ media = [MIDIA] } = {}) {
        super();
        this.resolveMediaByUuids = jest.fn(async (uuids) =>
            media.filter((row) => uuids.includes(row.uuid)));
        this.recordPlays = jest.fn(async ({ plays }) => ({
            accepted: plays.map((play) => play.event_uuid),
            duplicated: [],
        }));
        this.listMediaTotals = jest.fn(async () => ({ rows: [], total: 0 }));
        this.findMediaTotals = jest.fn(async () => null);
        this.listLocationsForMedia = jest.fn(async () => []);
        this.listPlayersForMedia = jest.fn(async () => []);
        this.listDaysForMedia = jest.fn(async () => []);
        this.listPlaysForPlayer = jest.fn(async () => ({ rows: [], total: 0 }));
    }
}

class FakePlayerRepository extends MieppPlayerRepositoryPort {
    constructor(player = { id: 1, name: 'Tela Caixa 1' }) {
        super();
        this.findById = jest.fn(async () => player);
        this.findGroupIds = jest.fn(async () => []);
        this.registerHeartbeat = jest.fn(async () => {});
    }
}

class FakeMediaRepository extends MediaRepositoryPort {
    constructor(media = { id: 5, uuid: 'media-uuid-0001', title: 'Campanha Setembro', type: 'image' }) {
        super();
        this.findById = jest.fn(async () => media);
    }
}

/** @param {object} [options] */
function makeIngest(options = {}) {
    const playRepository = options.playRepository || new FakePlayRepository();
    return {
        playRepository,
        useCases: new MieppDeviceUseCases({
            playerRepository: new FakePlayerRepository(),
            scheduleRepository: new MieppScheduleRepositoryPort(),
            playlistRepository: new MieppPlaylistRepositoryPort(),
            playRepository: options.omitPlayRepository ? null : playRepository,
            pairingService: { verify: jest.fn() },
            mediaTokenService: { buildUrl: jest.fn() },
        }),
    };
}

/** @param {object} [overrides] */
function exibicao(overrides = {}) {
    return {
        event_uuid: 'evento-0000000000001',
        media_uuid: 'media-uuid-0001',
        started_at: new Date(2026, 8, 21, 13, 59, 30),
        duration_ms: 12000,
        completed: true,
        ...overrides,
    };
}

beforeEach(() => jest.clearAllMocks());

// ═══════════════════════════════════════════════════════════════════════════
// INGEST — POST /miepp/device/plays
// ═══════════════════════════════════════════════════════════════════════════

describe('registro de exibições', () => {
    it('resolve a mídia pelo UUID e grava o id, nunca o que o device mandaria', async () => {
        const { useCases, playRepository } = makeIngest();

        await useCases.recordPlays(DEVICE, { plays: [exibicao()] }, AGORA);

        const [{ plays }] = playRepository.recordPlays.mock.calls[0];
        expect(plays[0].media_id).toBe(5);
        // Snapshot do título: o DELETE de mídia é físico.
        expect(plays[0].media_title).toBe('Campanha Setembro');
    });

    it('grava o local da tela como snapshot do momento', async () => {
        // Sem isto, mover a tela de loja migraria toda a audiência histórica
        // junto com o equipamento.
        const { useCases, playRepository } = makeIngest();

        await useCases.recordPlays(DEVICE, { plays: [exibicao()] }, AGORA);

        expect(playRepository.recordPlays).toHaveBeenCalledWith(
            expect.objectContaining({ playerId: 1, locationId: 3 })
        );
    });

    it('aceita tela sem local cadastrado', async () => {
        const { useCases, playRepository } = makeIngest();

        await useCases.recordPlays({ ...DEVICE, location_id: null }, { plays: [exibicao()] }, AGORA);

        expect(playRepository.recordPlays).toHaveBeenCalledWith(
            expect.objectContaining({ locationId: null })
        );
    });

    it('recusa a mídia que já foi apagada sem derrubar o resto do lote', async () => {
        // Cenário real: a tela ficou dias sem rede e a campanha saiu do ar.
        // Recusar o lote faria o app reenviar para sempre.
        const { useCases, playRepository } = makeIngest();

        const resultado = await useCases.recordPlays(DEVICE, {
            plays: [
                exibicao({ event_uuid: 'evento-conhecido-001' }),
                exibicao({ event_uuid: 'evento-apagado-0001', media_uuid: 'media-uuid-9999' }),
            ],
        }, AGORA);

        expect(resultado.accepted).toBe(1);
        expect(resultado.rejected).toEqual([
            { event_uuid: 'evento-apagado-0001', reason: RejectReason.UNKNOWN_MEDIA },
        ]);

        const [{ plays }] = playRepository.recordPlays.mock.calls[0];
        expect(plays).toHaveLength(1);
    });

    it('consulta as mídias do lote em uma só ida ao banco', async () => {
        // 200 exibições citam meia dúzia de mídias; uma consulta por evento
        // seriam 200 idas gastas à toa.
        const { useCases, playRepository } = makeIngest();

        await useCases.recordPlays(DEVICE, {
            plays: [
                exibicao({ event_uuid: 'evento-0000000000001' }),
                exibicao({ event_uuid: 'evento-0000000000002' }),
                exibicao({ event_uuid: 'evento-0000000000003' }),
            ],
        }, AGORA);

        expect(playRepository.resolveMediaByUuids).toHaveBeenCalledTimes(1);
        expect(playRepository.resolveMediaByUuids).toHaveBeenCalledWith(['media-uuid-0001']);
    });

    it('conta reenvio como duplicado, não como exibição nova', async () => {
        const playRepository = new FakePlayRepository();
        playRepository.recordPlays = jest.fn(async () => ({
            accepted: [],
            duplicated: ['evento-0000000000001'],
        }));
        const { useCases } = makeIngest({ playRepository });

        const resultado = await useCases.recordPlays(DEVICE, { plays: [exibicao()] }, AGORA);

        expect(resultado).toMatchObject({ received: 1, accepted: 0, duplicated: 1, rejected: [] });
    });

    it('recusa a requisição toda só quando não há lote nenhum para processar', async () => {
        const { useCases } = makeIngest();

        await expect(useCases.recordPlays(DEVICE, {}, AGORA)).rejects.toThrow(/obrigatório/);
        await expect(useCases.recordPlays(DEVICE, { plays: [] }, AGORA)).rejects.toThrow(/ao menos uma/);
    });

    it('não chama o banco quando nenhum evento do lote presta', async () => {
        const { useCases, playRepository } = makeIngest();

        const resultado = await useCases.recordPlays(DEVICE, {
            plays: [exibicao({ duration_ms: -1 })],
        }, AGORA);

        expect(resultado.accepted).toBe(0);
        expect(resultado.rejected).toHaveLength(1);
        expect(playRepository.recordPlays).toHaveBeenCalledWith(
            expect.objectContaining({ plays: [] })
        );
    });

    it('responde 503 quando o registro não está montado, sem afetar as outras rotas', async () => {
        const { useCases } = makeIngest({ omitPlayRepository: true });

        await expect(useCases.recordPlays(DEVICE, { plays: [exibicao()] }, AGORA))
            .rejects.toThrow(/indisponível/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// RELATÓRIOS — painel
// ═══════════════════════════════════════════════════════════════════════════

/** @param {object} [options] */
function makeReports(options = {}) {
    const repository = options.repository || new FakePlayRepository();
    return {
        repository,
        useCases: new MieppPlayUseCases({
            repository,
            mediaRepository: options.mediaRepository
                || new FakeMediaRepository(options.media === undefined ? undefined : options.media),
            playerRepository: options.playerRepository || new FakePlayerRepository(),
        }),
    };
}

describe('ranking de exibições', () => {
    it('devolve a janela usada junto com o resultado', async () => {
        const { useCases } = makeReports();

        const resultado = await useCases.listMediaPlays({ from: '2026-09-01', to: '2026-09-07' });

        expect(resultado.range).toEqual({ from: '2026-09-01', to: '2026-09-07', days: 7 });
        expect(resultado.pagination).toBeDefined();
    });

    it('repassa os filtros de local e tela', async () => {
        const { useCases, repository } = makeReports();

        await useCases.listMediaPlays({ location_id: '3', player_id: '8', media_id: '5' });

        expect(repository.listMediaTotals).toHaveBeenCalledWith(
            expect.objectContaining({ locationId: 3, playerId: 8, mediaId: 5 })
        );
    });

    it('trata filtro inválido como ausente, não como zero', async () => {
        const { useCases, repository } = makeReports();

        await useCases.listMediaPlays({ location_id: 'abc', player_id: '' });

        expect(repository.listMediaTotals).toHaveBeenCalledWith(
            expect.objectContaining({ locationId: null, playerId: null })
        );
    });
});

describe('relatório de uma mídia', () => {
    it('traz local, tela e dia na mesma resposta', async () => {
        const repository = new FakePlayRepository();
        repository.findMediaTotals = jest.fn(async () => ({
            plays: '30', completed_plays: '28', duration_ms: '360000',
            players: 3, locations: 2, media_title: 'Campanha Setembro',
        }));
        repository.listLocationsForMedia = jest.fn(async () => [
            { location_id: 3, location_name: 'Loja Centro', plays: '20', players: 2 },
            { location_id: 0, location_name: null, plays: '10', players: 1 },
        ]);
        repository.listPlayersForMedia = jest.fn(async () => [
            { player_id: 8, player_name: 'Tela Caixa 1', location_id: 3, plays: '20' },
        ]);
        repository.listDaysForMedia = jest.fn(async () => [
            { play_date: new Date(2026, 8, 21), plays: '30', players: 3 },
        ]);

        const { useCases } = makeReports({ repository });
        const resultado = await useCases.mediaPlayReport(5, { from: '2026-09-01', to: '2026-09-21' });

        expect(resultado.totals.plays).toBe(30);
        expect(resultado.by_location).toHaveLength(2);
        // O sentinela de "sem local" não vaza para a resposta.
        expect(resultado.by_location[1].location_id).toBeNull();
        expect(resultado.by_player[0].player_name).toBe('Tela Caixa 1');
        expect(resultado.by_day[0].play_date).toBe('2026-09-21');
    });

    it('entrega relatório zerado para mídia que existe e nunca passou', async () => {
        const { useCases } = makeReports();

        const resultado = await useCases.mediaPlayReport(5, {});

        expect(resultado.media.exists).toBe(true);
        expect(resultado.totals.plays).toBe(0);
    });

    it('continua respondendo por mídia apagada que tem histórico', async () => {
        // É o caso que o snapshot de título existe para servir: relatório de
        // campanha encerrada.
        const repository = new FakePlayRepository();
        repository.findMediaTotals = jest.fn(async () => ({
            plays: '12', completed_plays: '12', duration_ms: '120000',
            players: 1, locations: 1, media_title: 'Campanha Agosto',
        }));

        const { useCases } = makeReports({ repository, media: null });
        const resultado = await useCases.mediaPlayReport(5, {});

        expect(resultado.media).toMatchObject({ id: 5, title: 'Campanha Agosto', exists: false });
        expect(resultado.totals.plays).toBe(12);
    });

    it('404 só quando não há cadastro NEM histórico', async () => {
        const { useCases } = makeReports({ media: null });

        await expect(useCases.mediaPlayReport(5, {})).rejects.toThrow(/não encontrada/);
    });

    it('recusa id inválido antes de tocar no banco', async () => {
        const { useCases, repository } = makeReports();

        await expect(useCases.mediaPlayReport('abc', {})).rejects.toThrow(/inválido/);
        expect(repository.findMediaTotals).not.toHaveBeenCalled();
    });
});

describe('evidência crua de uma tela', () => {
    it('converte o tempo em tela para segundos e o completed para booleano', async () => {
        const repository = new FakePlayRepository();
        repository.listPlaysForPlayer = jest.fn(async () => ({
            rows: [{
                id: '900', event_uuid: 'evento-0000000000001', media_id: '5',
                media_uuid: 'media-uuid-0001', current_title: 'Campanha Setembro',
                media_title: 'Campanha Setembro', location_id: 3, location_name: 'Loja Centro',
                playlist_id: 2, schedule_id: null, started_at: '2026-09-21 13:59:30',
                duration_ms: '12000', completed: 1, reported_at: '2026-09-21 14:00:02',
            }],
            total: 1,
        }));

        const { useCases } = makeReports({ repository });
        const resultado = await useCases.listPlayerPlays(1, {});

        expect(resultado.items[0]).toMatchObject({
            id: 900,
            seconds_on_screen: 12,
            completed: true,
            schedule_id: null,
            media_exists: true,
        });
        expect(resultado.player).toEqual({ id: 1, name: 'Tela Caixa 1' });
    });

    it('404 para tela que não existe', async () => {
        const playerRepository = new FakePlayerRepository(null);
        const { useCases } = makeReports({ playerRepository });

        await expect(useCases.listPlayerPlays(999, {})).rejects.toThrow(/não encontrado/);
    });
});
