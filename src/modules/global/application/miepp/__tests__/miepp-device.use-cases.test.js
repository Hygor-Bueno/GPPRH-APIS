/**
 * @fileoverview Testes dos casos de uso do dispositivo.
 *
 * Usa fakes (subclasses das portas com `jest.fn()`), nunca o banco — convenção
 * firmada na migração do GTPP.
 */

const { MieppDeviceUseCases } = require('../device/miepp-device.use-cases');
const { MieppPlayerRepositoryPort } = require('../ports/miepp-player-repository.port');
const { MieppScheduleRepositoryPort } = require('../ports/miepp-schedule-repository.port');
const { MieppPlaylistRepositoryPort } = require('../ports/miepp-playlist-repository.port');

const QUARTA_14H = new Date(2026, 8, 16, 14, 0, 0);

const PLAYER = { id: 1, uuid: 'uuid-player', name: 'Tela Caixa 1', active: 1 };

class FakePlayerRepository extends MieppPlayerRepositoryPort {
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

class FakeScheduleRepository extends MieppScheduleRepositoryPort {
    constructor(schedules = []) {
        super();
        this.findActiveWithTargets = jest.fn(async () => schedules);
    }
}

class FakePlaylistRepository extends MieppPlaylistRepositoryPort {
    constructor(playlist = null, items = []) {
        super();
        this.findById = jest.fn(async () => playlist);
        this.findItems = jest.fn(async () => items);
    }
}

const fakePairing = { issue: jest.fn(), verify: jest.fn(() => PLAYER.id) };
const fakeMediaToken = { buildUrl: jest.fn((uuid) => `https://x/${uuid}`) };

function makeUseCases({
    schedules = [], playlist = null, items = [], config = {}, player,
    mediaRepository = null,
} = {}) {
    const playerRepository = player || new FakePlayerRepository();
    return {
        playerRepository,
        useCases: new MieppDeviceUseCases({
            playerRepository,
            scheduleRepository: new FakeScheduleRepository(schedules),
            playlistRepository: new FakePlaylistRepository(playlist, items),
            mediaRepository,
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

describe('mídia de reserva', () => {
    const schedule = {
        id: 1, name: 'promoção', playlist_id: 100, priority: 0, active: 1,
        days_of_week: 127, start_date: null, end_date: null,
        start_time: null, end_time: null, updated_at: '2026-01-01',
        targets: [{ target_type: 'all', target_id: null }],
    };

    const playlist = { id: 100, name: 'Grade Hortifruti', active: 1 };

    /** Item de grade — o único com prazo. `maxAge` 0 = preço não reconferido. */
    const gridItem = (maxAge) => ({
        item_id: 41, order_index: 0, transition: 'none', duration_override: null,
        media_uuid: 'uuid-grade', title: 'Grade', type: 'image', mime_type: 'image/webp',
        size_bytes: 101922, duration_seconds: 60, checksum: 'abc', status: 'ready',
        file_id: '9', grid_id: 7, max_age_seconds: maxAge,
    });

    const reserva = {
        id: 22, media_uuid: 'uuid-reserva', title: 'Institucional', type: 'video',
        mime_type: 'video/mp4', size_bytes: 25000000, duration_seconds: 45,
        checksum: 'def', status: 'ready', file_id: '12', grid_id: null,
    };

    const withFallback = (row, overrides = {}) => makeUseCases({
        schedules: [schedule],
        playlist,
        config: { fallbackMediaId: 22 },
        mediaRepository: { findForDevice: jest.fn(async () => row) },
        ...overrides,
    });

    it('vem em toda resposta, para o player ter a reserva ANTES de a rede cair', async () => {
        // Inclusive na resposta de lista vazia: uma reserva que só chega junto
        // com a expiração faltaria exatamente quando serve para alguma coisa.
        const { useCases } = withFallback(reserva, { schedules: [] });

        const result = await useCases.getPlaylist(PLAYER, QUARTA_14H);

        expect(result.keep_cache).toBe(true);
        expect(result.fallback.media.uuid).toBe('uuid-reserva');
        expect(result.fallback.media.origin).toBe('upload');
    });

    it('sem reserva configurada, o campo vem null', async () => {
        const { useCases } = makeUseCases({ schedules: [schedule], playlist, items: [gridItem(600)] });

        const result = await useCases.getPlaylist(PLAYER, QUARTA_14H);

        expect(result.fallback).toBeNull();
        expect(result.items[0].max_age_seconds).toBe(600);
    });

    it('recusa grade como reserva — trocaria preço vencido por outro preço', async () => {
        const { useCases } = withFallback({ ...reserva, grid_id: 3 });

        const result = await useCases.getPlaylist(PLAYER, QUARTA_14H);
        expect(result.fallback).toBeNull();
    });

    it('recusa mídia que não está pronta', async () => {
        const { useCases } = withFallback({ ...reserva, status: 'processing' });

        const result = await useCases.getPlaylist(PLAYER, QUARTA_14H);
        expect(result.fallback).toBeNull();
    });

    it('recusa id que não existe mais', async () => {
        const { useCases } = withFallback(null);

        const result = await useCases.getPlaylist(PLAYER, QUARTA_14H);
        expect(result.fallback).toBeNull();
    });

    it('a grade vencida sai e a reserva entra como item, para a APK antiga tocar', async () => {
        const { useCases } = withFallback(reserva, { items: [gridItem(0)] });

        const result = await useCases.getPlaylist(PLAYER, QUARTA_14H);

        // Uma APK que não conhece `fallback` receberia `items: []` e apagaria
        // a parede; com a reserva como item comum ela toca em qualquer versão.
        expect(result.items).toHaveLength(1);
        expect(result.items[0].item_id).toBe(0);
        expect(result.items[0].media.uuid).toBe('uuid-reserva');
        expect(result.items[0]).not.toHaveProperty('max_age_seconds');
    });

    it('sem reserva, a grade vencida continua no ar com prazo zero', async () => {
        // É o menos ruim: derrubar sem substituto apagaria a tela. O zero diz
        // ao app que o conteúdo venceu e passa a decisão para ele.
        const { useCases } = makeUseCases({ schedules: [schedule], playlist, items: [gridItem(0)] });

        const result = await useCases.getPlaylist(PLAYER, QUARTA_14H);

        expect(result.items).toHaveLength(1);
        expect(result.items[0].max_age_seconds).toBe(0);
        expect(result.items[0].media.origin).toBe('generated');
    });

    it('grade no prazo não é substituída', async () => {
        const { useCases } = withFallback(reserva, { items: [gridItem(1132)] });

        const result = await useCases.getPlaylist(PLAYER, QUARTA_14H);

        expect(result.items).toHaveLength(1);
        expect(result.items[0].item_id).toBe(41);
        expect(result.items[0].max_age_seconds).toBe(1132);
        // A reserva continua sendo entregue, só não está tocando.
        expect(result.fallback.media.uuid).toBe('uuid-reserva');
    });
});

describe('heartbeat', () => {
    it('prefere o local_ip informado pelo app, que é o que localiza a tela', async () => {
        const { useCases, playerRepository } = makeUseCases();

        await useCases.heartbeat(PLAYER, { app_version: '1.2.0', local_ip: '192.168.1.47' }, '203.0.113.50');

        const [, beat] = playerRepository.registerHeartbeat.mock.calls[0];
        expect(beat.ip).toBe('192.168.1.47');
        expect(beat.appVersion).toBe('1.2.0');
        // O observado fica guardado para conferência, não se perde.
        expect(beat.detail.observed_ip).toBe('203.0.113.50');
    });

    it('cai no IP observado quando o app não informa o local_ip', async () => {
        const { useCases, playerRepository } = makeUseCases();

        await useCases.heartbeat(PLAYER, { app_version: '1.2.0' }, '203.0.113.50');

        const [, beat] = playerRepository.registerHeartbeat.mock.calls[0];
        expect(beat.ip).toBe('203.0.113.50');
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
