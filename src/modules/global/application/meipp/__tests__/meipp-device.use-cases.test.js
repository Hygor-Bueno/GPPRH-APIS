/**
 * @fileoverview Testes dos casos de uso do dispositivo.
 *
 * Usa fakes (subclasses das portas com `jest.fn()`), nunca o banco — convenção
 * firmada na migração do GTPP.
 */

const { MeippDeviceUseCases } = require('../device/meipp-device.use-cases');
const { MeippPlayerRepositoryPort } = require('../ports/meipp-player-repository.port');
const { MeippScheduleRepositoryPort } = require('../ports/meipp-schedule-repository.port');
const { MeippPlaylistRepositoryPort } = require('../ports/meipp-playlist-repository.port');

const QUARTA_14H = new Date(2026, 8, 16, 14, 0, 0);

const PLAYER = { id: 1, uuid: 'uuid-player', name: 'Tela Caixa 1', active: 1 };

class FakePlayerRepository extends MeippPlayerRepositoryPort {
    constructor() {
        super();
        this.findById = jest.fn(async () => PLAYER);
        this.findGroupIds = jest.fn(async () => [7]);
        this.replaceDeviceToken = jest.fn(async () => {});
        this.registerHeartbeat = jest.fn(async () => {});
        this.claimPendingCommands = jest.fn(async () => []);
        this.ackCommand = jest.fn(async () => true);
    }
}

class FakeScheduleRepository extends MeippScheduleRepositoryPort {
    constructor(schedules = []) {
        super();
        this.findActiveWithTargets = jest.fn(async () => schedules);
    }
}

class FakePlaylistRepository extends MeippPlaylistRepositoryPort {
    constructor(playlist = null, items = []) {
        super();
        this.findById = jest.fn(async () => playlist);
        this.findItems = jest.fn(async () => items);
    }
}

const fakePairing = { issue: jest.fn(), verify: jest.fn(() => PLAYER.id) };
const fakeMediaToken = { buildUrl: jest.fn((uuid) => `https://x/${uuid}`) };

function makeUseCases({ schedules = [], playlist = null, items = [], config = {}, player } = {}) {
    const playerRepository = player || new FakePlayerRepository();
    return {
        playerRepository,
        useCases: new MeippDeviceUseCases({
            playerRepository,
            scheduleRepository: new FakeScheduleRepository(schedules),
            playlistRepository: new FakePlaylistRepository(playlist, items),
            pairingService: fakePairing,
            mediaTokenService: fakeMediaToken,
            config,
        }),
    };
}

beforeEach(() => jest.clearAllMocks());

describe('pareamento', () => {
    it('devolve o token em texto puro e grava só o hash', async () => {
        const { useCases, playerRepository } = makeUseCases();

        const result = await useCases.pair('codigo-valido');

        expect(result.token).toMatch(/^[0-9a-f]{64}$/);

        // O que foi para o repositório é o SHA-256 do token, nunca o token.
        const [, gravado] = playerRepository.replaceDeviceToken.mock.calls[0];
        expect(gravado).toHaveLength(64);
        expect(gravado).not.toBe(result.token);
    });

    it('sem TTL configurado, o token não expira', async () => {
        const { useCases, playerRepository } = makeUseCases();
        const result = await useCases.pair('codigo-valido');

        expect(result.expires_at).toBeNull();
        expect(playerRepository.replaceDeviceToken.mock.calls[0][2]).toBeNull();
    });

    it('com TTL configurado, grava a data de expiração', async () => {
        const { useCases, playerRepository } = makeUseCases({ config: { deviceTokenTtlDays: 30 } });
        const result = await useCases.pair('codigo-valido');

        expect(result.expires_at).not.toBeNull();
        expect(playerRepository.replaceDeviceToken.mock.calls[0][2]).toBeInstanceOf(Date);
    });

    it('player desativado recebe o mesmo 401 de código inválido', async () => {
        const playerRepository = new FakePlayerRepository();
        playerRepository.findById = jest.fn(async () => ({ ...PLAYER, active: 0 }));

        const { useCases } = makeUseCases({ player: playerRepository });

        // Mensagem idêntica à de código inválido: distinguir os casos
        // transformaria a rota num oráculo sobre quais players existem.
        await expect(useCases.pair('codigo-valido')).rejects.toMatchObject({
            statusCode: 401,
            message: 'Código de pareamento inválido ou expirado.',
        });
    });
});

describe('resolução da playlist', () => {
    const schedule = {
        id: 1, name: 'institucional', playlist_id: 100, priority: 0, active: 1,
        days_of_week: 127, start_date: null, end_date: null,
        start_time: null, end_time: null, updated_at: '2026-01-01',
        targets: [{ target_type: 'all', target_id: null }],
    };

    const playlist = { id: 100, name: 'Institucional', active: 1 };

    const item = {
        item_id: 1, order_index: 0, transition: 'none', duration_override: null,
        media_uuid: 'uuid-a', title: 'Cartaz', type: 'image', mime_type: 'image/webp',
        size_bytes: 10, duration_seconds: 12, checksum: 'abc', status: 'ready', file_id: '1',
    };

    it('entrega os itens da playlist do agendamento vencedor, com URL assinada', async () => {
        const { useCases } = makeUseCases({ schedules: [schedule], playlist, items: [item] });

        const result = await useCases.getPlaylist(PLAYER, QUARTA_14H);

        expect(result.playlist.id).toBe(100);
        expect(result.keep_cache).toBe(false);
        expect(result.items).toHaveLength(1);
        expect(result.items[0].media.url).toBe('https://x/uuid-a');
        expect(result.items[0].duration).toBe(12);
    });

    it('sem agendamento e sem fallback, manda manter o cache em vez de apagar a tela', async () => {
        const { useCases } = makeUseCases({ schedules: [], playlist });

        const result = await useCases.getPlaylist(PLAYER, QUARTA_14H);

        expect(result.schedule).toBeNull();
        expect(result.items).toEqual([]);
        // Uma tela preta na loja é pior do que o conteúdo de ontem.
        expect(result.keep_cache).toBe(true);
    });

    it('sem agendamento, usa a playlist de fallback quando configurada', async () => {
        const { useCases } = makeUseCases({
            schedules: [],
            playlist: { id: 900, name: 'Padrão', active: 1 },
            items: [item],
            config: { fallbackPlaylistId: 900 },
        });

        const result = await useCases.getPlaylist(PLAYER, QUARTA_14H);

        expect(result.playlist.id).toBe(900);
        expect(result.schedule.name).toBe('fallback');
        expect(result.items).toHaveLength(1);
    });

    it('playlist inativa é tratada como ausente', async () => {
        const { useCases } = makeUseCases({
            schedules: [schedule],
            playlist: { id: 100, name: 'Institucional', active: 0 },
        });

        const result = await useCases.getPlaylist(PLAYER, QUARTA_14H);
        expect(result.keep_cache).toBe(true);
        expect(result.items).toEqual([]);
    });
});

describe('heartbeat', () => {
    it('grava o IP observado pelo servidor e ignora o que o corpo alega', async () => {
        const { useCases, playerRepository } = makeUseCases();

        await useCases.heartbeat(PLAYER, { app_version: '1.2.0', ip: '9.9.9.9' }, '10.0.0.5');

        const [, beat] = playerRepository.registerHeartbeat.mock.calls[0];
        expect(beat.ip).toBe('10.0.0.5');
        expect(beat.appVersion).toBe('1.2.0');
    });

    it('só campos conhecidos entram no detail, nunca o corpo cru', async () => {
        const { useCases, playerRepository } = makeUseCases();

        await useCases.heartbeat(PLAYER, { memory_used_mb: 128, injetado: 'x' }, null);

        const [, beat] = playerRepository.registerHeartbeat.mock.calls[0];
        expect(beat.detail.memory_used_mb).toBe(128);
        expect(beat.detail).not.toHaveProperty('injetado');
    });
});

describe('ACK de comando', () => {
    it('aceita acknowledged e failed', async () => {
        const { useCases } = makeUseCases();
        await expect(useCases.ackCommand(PLAYER, 5, 'acknowledged')).resolves.toMatchObject({ id: 5 });
        await expect(useCases.ackCommand(PLAYER, 5, 'failed')).resolves.toMatchObject({ id: 5 });
    });

    it('recusa estado que é do servidor, não do device', async () => {
        const { useCases } = makeUseCases();
        await expect(useCases.ackCommand(PLAYER, 5, 'pending')).rejects.toMatchObject({ statusCode: 400 });
        await expect(useCases.ackCommand(PLAYER, 5, 'sent')).rejects.toMatchObject({ statusCode: 400 });
    });

    it('404 quando o comando não é deste player', async () => {
        const playerRepository = new FakePlayerRepository();
        playerRepository.ackCommand = jest.fn(async () => false);

        const { useCases } = makeUseCases({ player: playerRepository });

        await expect(useCases.ackCommand(PLAYER, 5, 'acknowledged'))
            .rejects.toMatchObject({ statusCode: 404 });
    });
});
