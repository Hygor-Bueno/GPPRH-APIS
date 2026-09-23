/**
 * @fileoverview Testes da crítica do lote de exibições.
 *
 * O que estes testes protegem, acima de tudo: um evento ruim NÃO pode derrubar
 * os bons. Se isso regredir, a fila local do player trava e a tela para de
 * reportar audiência para sempre.
 */

const {
    MAX_PLAYS_PER_BATCH,
    MAX_DURATION_MS,
    RejectReason,
    toMysqlDateTime,
    toMysqlDate,
    normalizePlay,
    normalizeBatch,
    findBatchError,
} = require('../play-event.rules');

/** Segunda, 21/09/2026, 14h — hora LOCAL, para não depender do fuso da máquina. */
const AGORA = new Date(2026, 8, 21, 14, 0, 0);

/** @param {object} [overrides] */
function evento(overrides = {}) {
    return {
        event_uuid: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        media_uuid: 'media-uuid-0001',
        started_at: new Date(2026, 8, 21, 13, 59, 30),
        duration_ms: 12000,
        completed: true,
        ...overrides,
    };
}

describe('toMysqlDateTime', () => {
    it('formata nos componentes locais, sem passar por UTC', () => {
        // O ponto do teste: 13:59:30 local tem de sair como 13:59:30, qualquer
        // que seja o fuso do processo. Entregar um Date ao driver deixaria a
        // conversão por conta do fuso e este banco já pagou por isso.
        expect(toMysqlDateTime(new Date(2026, 8, 21, 13, 59, 30))).toBe('2026-09-21 13:59:30');
        expect(toMysqlDate(new Date(2026, 8, 21, 13, 59, 30))).toBe('2026-09-21');
    });

    it('preenche com zero à esquerda', () => {
        expect(toMysqlDateTime(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02 03:04:05');
    });

    it('usa o dia LOCAL na virada da meia-noite', () => {
        // O dia do acumulado vem daqui, não de `DATE()` no SQL, justamente para
        // que cru e acumulado não discordem de dia nesta borda.
        expect(toMysqlDate(new Date(2026, 8, 21, 23, 59, 59))).toBe('2026-09-21');
        expect(toMysqlDate(new Date(2026, 8, 22, 0, 0, 0))).toBe('2026-09-22');
    });
});

describe('normalizePlay', () => {
    it('normaliza um evento bom e deriva o dia do acumulado', () => {
        const { play } = normalizePlay(evento(), AGORA);

        expect(play).toMatchObject({
            event_uuid: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
            media_uuid: 'media-uuid-0001',
            started_at: '2026-09-21 13:59:30',
            play_date: '2026-09-21',
            duration_ms: 12000,
            completed: 1,
            playlist_id: null,
            schedule_id: null,
        });
    });

    it('aceita `completed` como true, 1 ou "true" — APKs diferentes mandam diferente', () => {
        for (const valor of [true, 1, 'true']) {
            expect(normalizePlay(evento({ completed: valor }), AGORA).play.completed).toBe(1);
        }
    });

    it('trata `completed` ausente como exibição cortada', () => {
        // Conservador de propósito: não inflar `completed_plays` é melhor do
        // que inflar.
        const { play } = normalizePlay(evento({ completed: undefined }), AGORA);
        expect(play.completed).toBe(0);
    });

    it('recusa chave de idempotência ausente ou curta', () => {
        expect(normalizePlay(evento({ event_uuid: undefined }), AGORA).reason)
            .toBe(RejectReason.INVALID_EVENT_UUID);
        expect(normalizePlay(evento({ event_uuid: 'curto' }), AGORA).reason)
            .toBe(RejectReason.INVALID_EVENT_UUID);
    });

    it('recusa uuid de mídia fora de formato', () => {
        expect(normalizePlay(evento({ media_uuid: 'tem espaço' }), AGORA).reason)
            .toBe(RejectReason.INVALID_MEDIA_UUID);
    });

    it('recusa data ilegível', () => {
        expect(normalizePlay(evento({ started_at: 'ontem' }), AGORA).reason)
            .toBe(RejectReason.INVALID_STARTED_AT);
        expect(normalizePlay(evento({ started_at: null }), AGORA).reason)
            .toBe(RejectReason.INVALID_STARTED_AT);
    });

    it('recusa relógio adiantado além da tolerância, mas aceita dentro dela', () => {
        const duasHorasAdiante = new Date(AGORA.getTime() + 2 * 60 * 60 * 1000);
        expect(normalizePlay(evento({ started_at: duasHorasAdiante }), AGORA).reason)
            .toBe(RejectReason.STARTED_AT_IN_FUTURE);

        // Deriva comum de relógio de caixa Android não pode custar a exibição.
        const meiaHoraAdiante = new Date(AGORA.getTime() + 30 * 60 * 1000);
        expect(normalizePlay(evento({ started_at: meiaHoraAdiante }), AGORA).play).toBeDefined();
    });

    it('aceita fila atrasada de dias e recusa relógio de fábrica', () => {
        // Tela dias sem rede é o cenário NORMAL numa loja.
        const tresDiasAtras = new Date(AGORA.getTime() - 3 * 24 * 60 * 60 * 1000);
        expect(normalizePlay(evento({ started_at: tresDiasAtras }), AGORA).play).toBeDefined();

        const anoErrado = new Date(2020, 0, 1);
        expect(normalizePlay(evento({ started_at: anoErrado }), AGORA).reason)
            .toBe(RejectReason.STARTED_AT_TOO_OLD);
    });

    it('recusa duração negativa ou acima do teto de 24h', () => {
        expect(normalizePlay(evento({ duration_ms: -1 }), AGORA).reason)
            .toBe(RejectReason.INVALID_DURATION);
        expect(normalizePlay(evento({ duration_ms: MAX_DURATION_MS + 1 }), AGORA).reason)
            .toBe(RejectReason.INVALID_DURATION);
        expect(normalizePlay(evento({ duration_ms: MAX_DURATION_MS }), AGORA).play).toBeDefined();
    });

    it('aceita duração zero — exibição cortada na largada ainda é evidência', () => {
        expect(normalizePlay(evento({ duration_ms: 0 }), AGORA).play.duration_ms).toBe(0);
    });

    it('descarta playlist_id e schedule_id inválidos sem recusar o evento', () => {
        // São snapshot de contexto, não a medida. Perder o contexto é melhor do
        // que perder a exibição.
        const { play } = normalizePlay(evento({ playlist_id: 'abc', schedule_id: 0 }), AGORA);
        expect(play.playlist_id).toBeNull();
        expect(play.schedule_id).toBeNull();
    });
});

describe('normalizeBatch', () => {
    it('um evento ruim não derruba os bons', () => {
        // O teste central do módulo: é o que impede a fila do player de travar.
        const { plays, rejected } = normalizeBatch([
            evento({ event_uuid: 'evento-bom-00000001' }),
            evento({ event_uuid: 'evento-ruim-0000001', duration_ms: -5 }),
            evento({ event_uuid: 'evento-bom-00000002' }),
        ], AGORA);

        expect(plays.map((play) => play.event_uuid))
            .toEqual(['evento-bom-00000001', 'evento-bom-00000002']);
        expect(rejected).toEqual([
            { event_uuid: 'evento-ruim-0000001', reason: RejectReason.INVALID_DURATION },
        ]);
    });

    it('deduplica dentro do lote antes de o banco ver', () => {
        // Sem isto o segundo INSERT colidiria no meio da transação e o lote
        // TODO voltaria — exatamente o que a crítica por evento evita.
        const { plays, rejected } = normalizeBatch([
            evento({ event_uuid: 'repetido-no-lote-01' }),
            evento({ event_uuid: 'repetido-no-lote-01' }),
        ], AGORA);

        expect(plays).toHaveLength(1);
        expect(rejected).toEqual([
            { event_uuid: 'repetido-no-lote-01', reason: RejectReason.DUPLICATE_IN_BATCH },
        ]);
    });

    it('nomeia a recusa mesmo quando o evento é lixo', () => {
        // O app precisa saber o que descartar; um evento sem nome nenhum na
        // resposta ficaria preso na fila.
        const { plays, rejected } = normalizeBatch([null, 'texto', {}], AGORA);

        expect(plays).toHaveLength(0);
        expect(rejected).toHaveLength(3);
        expect(rejected.every((item) => item.reason === RejectReason.INVALID_EVENT_UUID)).toBe(true);
    });
});

describe('findBatchError', () => {
    it('recusa corpo sem lista e lista vazia', () => {
        expect(findBatchError(undefined)).toMatch(/obrigatório/);
        expect(findBatchError({})).toMatch(/obrigatório/);
        expect(findBatchError([])).toMatch(/ao menos uma/);
    });

    it('recusa lote acima do teto dizendo o teto', () => {
        const lote = Array.from({ length: MAX_PLAYS_PER_BATCH + 1 }, () => evento());
        expect(findBatchError(lote)).toMatch(String(MAX_PLAYS_PER_BATCH));
    });

    it('aceita lote exatamente no teto', () => {
        const lote = Array.from({ length: MAX_PLAYS_PER_BATCH }, () => evento());
        expect(findBatchError(lote)).toBeNull();
    });
});
