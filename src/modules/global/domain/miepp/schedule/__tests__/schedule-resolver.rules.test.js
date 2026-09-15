/**
 * @fileoverview Testes da regra central do miepp.
 *
 * Esta é a única regra do módulo cujo erro não aparece como exceção: aparece
 * como a tela errada tocando na loja. Por isso a cobertura aqui é por cenário
 * de negócio, não por linha.
 *
 * Todas as datas usam `new Date(ano, mês, dia, ...)` (hora local) porque é
 * assim que o resolvedor lê `Date#getDay()` e as colunas DATE do MySQL, que
 * chegam como meia-noite local.
 */

const {
    resolveActiveSchedule,
    findMatchingSchedules,
    withinDateRange,
    withinTimeRange,
    toDateKey,
    toTimeKey,
} = require('../schedule-resolver.rules');

/** Quarta-feira, 16/09/2026, 14:00. Dia da semana = 3. */
const QUARTA_14H = new Date(2026, 8, 16, 14, 0, 0);

/** Agendamento "vale sempre, para todo mundo" — base dos cenários. */
function makeSchedule(overrides = {}) {
    return {
        id: 1,
        name: 'base',
        playlist_id: 100,
        priority: 0,
        start_date: null,
        end_date: null,
        start_time: null,
        end_time: null,
        days_of_week: 127,
        active: 1,
        updated_at: '2026-01-01T00:00:00Z',
        targets: [{ target_type: 'all', target_id: null }],
        ...overrides,
    };
}

describe('normalização de colunas', () => {
    it('converte DATE vindo como Date para YYYY-MM-DD em hora local', () => {
        expect(toDateKey(new Date(2026, 8, 16))).toBe('2026-09-16');
    });

    it('aceita DATE já em string e ignora a parte de hora', () => {
        expect(toDateKey('2026-09-16 10:30:00')).toBe('2026-09-16');
    });

    it('trata coluna NULL como "sem limite"', () => {
        expect(toDateKey(null)).toBeNull();
        expect(toTimeKey(null)).toBeNull();
    });

    it('zero-padda TIME para que a comparação de texto seja cronológica', () => {
        expect(toTimeKey('8:05')).toBe('08:05:00');
        // Sem o padding, '8:05' > '14:00' em comparação de string — o
        // agendamento da manhã venceria o da tarde.
        expect(toTimeKey('8:05') < toTimeKey('14:00')).toBe(true);
    });
});

describe('filtro por alvo', () => {
    it('alcança qualquer player quando o alvo é "all"', () => {
        const found = findMatchingSchedules({
            schedules: [makeSchedule()],
            playerId: 99,
            groupIds: [],
            now: QUARTA_14H,
        });
        expect(found).toHaveLength(1);
    });

    it('alcança o player nomeado e ninguém mais', () => {
        const schedules = [makeSchedule({
            targets: [{ target_type: 'player', target_id: 5 }],
        })];

        expect(findMatchingSchedules({ schedules, playerId: 5, now: QUARTA_14H })).toHaveLength(1);
        expect(findMatchingSchedules({ schedules, playerId: 6, now: QUARTA_14H })).toHaveLength(0);
    });

    it('alcança o player por qualquer grupo em que ele esteja', () => {
        const schedules = [makeSchedule({
            targets: [{ target_type: 'group', target_id: 7 }],
        })];

        expect(findMatchingSchedules({
            schedules, playerId: 1, groupIds: [3, 7], now: QUARTA_14H,
        })).toHaveLength(1);

        expect(findMatchingSchedules({
            schedules, playerId: 1, groupIds: [3], now: QUARTA_14H,
        })).toHaveLength(0);
    });

    it('não alcança ninguém quando o agendamento não tem alvo cadastrado', () => {
        const schedules = [makeSchedule({ targets: [] })];
        expect(findMatchingSchedules({ schedules, playerId: 1, now: QUARTA_14H })).toHaveLength(0);
    });
});

describe('filtro por vigência de data', () => {
    const hoje = '2026-09-16';

    it('aceita quando os dois limites são NULL', () => {
        expect(withinDateRange(makeSchedule(), hoje)).toBe(true);
    });

    it('aceita o dia exato de início e de fim', () => {
        expect(withinDateRange(makeSchedule({ start_date: '2026-09-16' }), hoje)).toBe(true);
        expect(withinDateRange(makeSchedule({ end_date: '2026-09-16' }), hoje)).toBe(true);
    });

    it('recusa antes do início e depois do fim', () => {
        expect(withinDateRange(makeSchedule({ start_date: '2026-09-17' }), hoje)).toBe(false);
        expect(withinDateRange(makeSchedule({ end_date: '2026-09-15' }), hoje)).toBe(false);
    });
});

describe('filtro por janela de horário', () => {
    const agora = '14:00:00';

    it('aceita dentro da janela e nos extremos', () => {
        expect(withinTimeRange(makeSchedule({ start_time: '08:00:00', end_time: '18:00:00' }), agora)).toBe(true);
        expect(withinTimeRange(makeSchedule({ start_time: '14:00:00' }), agora)).toBe(true);
        expect(withinTimeRange(makeSchedule({ end_time: '14:00:00' }), agora)).toBe(true);
    });

    it('recusa fora da janela', () => {
        expect(withinTimeRange(makeSchedule({ start_time: '15:00:00' }), agora)).toBe(false);
        expect(withinTimeRange(makeSchedule({ end_time: '13:59:59' }), agora)).toBe(false);
    });

    it('documenta a limitação: janela que cruza a meia-noite nunca casa', () => {
        // 22:00 → 02:00. É o comportamento especificado, não um bug encoberto:
        // às 23:00 falha o end_time, à 01:00 falha o start_time.
        const madrugada = makeSchedule({ start_time: '22:00:00', end_time: '02:00:00' });
        expect(withinTimeRange(madrugada, '23:00:00')).toBe(false);
        expect(withinTimeRange(madrugada, '01:00:00')).toBe(false);
    });
});

describe('filtro por dia da semana', () => {
    it('casa quando o bit do dia atual está ligado', () => {
        // Quarta = bit 3 → 0b0001000 = 8
        const schedules = [makeSchedule({ days_of_week: 0b0001000 })];
        expect(findMatchingSchedules({ schedules, playerId: 1, now: QUARTA_14H })).toHaveLength(1);
    });

    it('não casa quando só outro dia está ligado', () => {
        // Só domingo (bit 0)
        const schedules = [makeSchedule({ days_of_week: 0b0000001 })];
        expect(findMatchingSchedules({ schedules, playerId: 1, now: QUARTA_14H })).toHaveLength(0);
    });

    it('bitmask 0 desliga o agendamento em todos os dias', () => {
        const schedules = [makeSchedule({ days_of_week: 0 })];
        expect(findMatchingSchedules({ schedules, playerId: 1, now: QUARTA_14H })).toHaveLength(0);
    });
});

describe('agendamento inativo', () => {
    it('é descartado mesmo casando em todo o resto', () => {
        const schedules = [makeSchedule({ active: 0 })];
        expect(findMatchingSchedules({ schedules, playerId: 1, now: QUARTA_14H })).toHaveLength(0);
    });
});

describe('desempate', () => {
    it('a maior prioridade vence', () => {
        const schedules = [
            makeSchedule({ id: 1, priority: 1 }),
            makeSchedule({ id: 2, priority: 9 }),
            makeSchedule({ id: 3, priority: 5 }),
        ];
        expect(resolveActiveSchedule({ schedules, playerId: 1, now: QUARTA_14H }).id).toBe(2);
    });

    it('empate na prioridade vai para o atualizado mais recentemente', () => {
        const schedules = [
            makeSchedule({ id: 1, priority: 5, updated_at: '2026-01-01T00:00:00Z' }),
            makeSchedule({ id: 2, priority: 5, updated_at: '2026-06-01T00:00:00Z' }),
        ];
        expect(resolveActiveSchedule({ schedules, playerId: 1, now: QUARTA_14H }).id).toBe(2);
    });

    it('empate total é resolvido pelo maior id, sem alternar entre chamadas', () => {
        // O updated_at do MySQL tem resolução de 1s: dois agendamentos salvos
        // no mesmo segundo empatam de verdade. Sem o terceiro critério a tela
        // piscaria entre dois conteúdos.
        const schedules = [
            makeSchedule({ id: 4, priority: 5, updated_at: '2026-06-01T00:00:00Z' }),
            makeSchedule({ id: 9, priority: 5, updated_at: '2026-06-01T00:00:00Z' }),
        ];

        const primeira = resolveActiveSchedule({ schedules, playerId: 1, now: QUARTA_14H });
        const segunda = resolveActiveSchedule({
            schedules: [...schedules].reverse(), playerId: 1, now: QUARTA_14H,
        });

        expect(primeira.id).toBe(9);
        expect(segunda.id).toBe(9);
    });

    it('prioridade negativa perde para a padrão', () => {
        const schedules = [
            makeSchedule({ id: 1, priority: -5 }),
            makeSchedule({ id: 2, priority: 0 }),
        ];
        expect(resolveActiveSchedule({ schedules, playerId: 1, now: QUARTA_14H }).id).toBe(2);
    });
});

describe('nenhum agendamento aplicável', () => {
    it('devolve null para o chamador decidir o fallback', () => {
        expect(resolveActiveSchedule({ schedules: [], playerId: 1, now: QUARTA_14H })).toBeNull();
    });
});

describe('cenário composto', () => {
    it('o específico da promoção vence o institucional no horário dela', () => {
        const institucional = makeSchedule({
            id: 1, name: 'institucional', playlist_id: 100, priority: 0,
        });

        const promocao = makeSchedule({
            id: 2,
            name: 'promoção de quarta',
            playlist_id: 200,
            priority: 10,
            start_date: '2026-09-01',
            end_date: '2026-09-30',
            start_time: '12:00:00',
            end_time: '15:00:00',
            days_of_week: 0b0001000, // só quarta
            targets: [{ target_type: 'group', target_id: 7 }],
        });

        const schedules = [institucional, promocao];

        // Quarta 14h, player do grupo 7 → promoção.
        expect(resolveActiveSchedule({
            schedules, playerId: 1, groupIds: [7], now: QUARTA_14H,
        }).playlist_id).toBe(200);

        // Mesma hora, player fora do grupo → institucional.
        expect(resolveActiveSchedule({
            schedules, playerId: 2, groupIds: [], now: QUARTA_14H,
        }).playlist_id).toBe(100);

        // Quarta 16h (fora da janela) → institucional.
        expect(resolveActiveSchedule({
            schedules, playerId: 1, groupIds: [7], now: new Date(2026, 8, 16, 16, 0, 0),
        }).playlist_id).toBe(100);

        // Quinta 14h (fora do dia) → institucional.
        expect(resolveActiveSchedule({
            schedules, playerId: 1, groupIds: [7], now: new Date(2026, 8, 17, 14, 0, 0),
        }).playlist_id).toBe(100);

        // Outubro (fora da vigência) → institucional.
        expect(resolveActiveSchedule({
            schedules, playerId: 1, groupIds: [7], now: new Date(2026, 9, 7, 14, 0, 0),
        }).playlist_id).toBe(100);
    });
});
