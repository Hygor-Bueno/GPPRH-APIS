const { coverageUntil, resolveWindow } = require('../inconsistency/analysis-window.rules');
const { isScheduleDue, resolveCollectRequest } = require('../collect/collect-schedule.rules');
const { pickContract, normalizeProtheusDate } = require('../employee.rules');

const BASE = { baselineDays: 60, maxPeriodDays: 92 };

describe('coverageUntil', () => {
    test('véspera da última coleta bem-sucedida', () => {
        expect(coverageUntil(['2026-10-08T02:00:05'])).toBe('2026-10-07');
    });
    test('com dois relógios, o menor', () => {
        expect(coverageUntil(['2026-10-08T02:00:05', '2026-10-05T02:00:00'])).toBe('2026-10-04');
    });
    test('relógio nunca coletado não entra; nenhum coletado = nada a analisar', () => {
        expect(coverageUntil([null, '2026-10-08T02:00:05'])).toBe('2026-10-07');
        expect(coverageUntil([null])).toBeNull();
    });
});

describe('resolveWindow — o dia corrente nunca é analisado', () => {
    test('pedir até hoje corta em ontem', () => {
        const w = resolveWindow({ ...BASE, from: '2026-10-01', to: '2026-10-08', today: '2026-10-08', coverage: '2026-10-08' });
        expect(w.to).toBe('2026-10-07');
    });

    test('coleta atrasada corta antes de ontem', () => {
        const w = resolveWindow({ ...BASE, from: '2026-10-01', to: '2026-10-08', today: '2026-10-08', coverage: '2026-10-04' });
        expect(w.to).toBe('2026-10-04');
        expect(w.cutoff).toBe('2026-10-04');
    });

    test('sem período, últimos 30 dias até o corte', () => {
        const w = resolveWindow({ ...BASE, today: '2026-10-08', coverage: '2026-10-07' });
        expect(w).toMatchObject({ from: '2026-09-08', to: '2026-10-07', empty: false });
    });

    test('histórico do fecha_cedo começa 60 dias antes do fim, mesmo com período curto', () => {
        const w = resolveWindow({ ...BASE, from: '2026-10-01', to: '2026-10-07', today: '2026-10-08', coverage: '2026-10-07' });
        expect(w.fetchFrom).toBe('2026-08-09');
    });

    test('período inteiro depois do corte fica vazio', () => {
        const w = resolveWindow({ ...BASE, from: '2026-10-08', to: '2026-10-08', today: '2026-10-08', coverage: '2026-10-07' });
        expect(w.empty).toBe(true);
    });

    test('nenhuma coleta ainda = vazio', () => {
        expect(resolveWindow({ ...BASE, today: '2026-10-08', coverage: null }).empty).toBe(true);
    });

    test('período longo demais e datas inválidas são 400', () => {
        expect(() => resolveWindow({ ...BASE, from: '2026-01-01', to: '2026-10-07', today: '2026-10-08', coverage: '2026-10-07' })).toThrow(/92 dias/);
        expect(() => resolveWindow({ ...BASE, from: '2026-13-01', today: '2026-10-08', coverage: '2026-10-07' })).toThrow(/from/);
        expect(() => resolveWindow({ ...BASE, from: '2026-10-05', to: '2026-10-01', today: '2026-10-08', coverage: '2026-10-07' })).toThrow();
    });
});

describe('isScheduleDue — uma vez por dia', () => {
    const at = (iso) => new Date(iso); // sem Z: hora local do processo

    test('antes do horário, não', () => {
        expect(isScheduleDue({ now: at('2026-10-08T01:59:00'), collectTime: '02:00', lastScheduledAt: '2026-10-07T02:00:10' })).toBe(false);
    });
    test('depois do horário, se a de hoje ainda não foi criada', () => {
        expect(isScheduleDue({ now: at('2026-10-08T02:00:30'), collectTime: '02:00', lastScheduledAt: '2026-10-07T02:00:10' })).toBe(true);
    });
    test('a de hoje já foi criada: não repete', () => {
        expect(isScheduleDue({ now: at('2026-10-08T15:00:00'), collectTime: '02:00', lastScheduledAt: '2026-10-08T02:00:10' })).toBe(false);
    });
    test('worker parado no horário recupera ao voltar', () => {
        expect(isScheduleDue({ now: at('2026-10-08T09:00:00'), collectTime: '02:00', lastScheduledAt: '2026-10-06T02:00:10' })).toBe(true);
    });
    test('primeira vez', () => {
        expect(isScheduleDue({ now: at('2026-10-08T09:00:00'), collectTime: '02:00', lastScheduledAt: null })).toBe(true);
    });
    test('horário inválido é erro de configuração', () => {
        expect(() => isScheduleDue({ now: at('2026-10-08T09:00:00'), collectTime: '2h', lastScheduledAt: null })).toThrow(/CPPP_COLLECT_TIME/);
    });
});

describe('resolveCollectRequest', () => {
    test('nada gravado: AFD integral', () => {
        expect(resolveCollectRequest(null)).toEqual({ initialNsr: null, requestedFrom: 'full' });
    });
    test('incremental do fim do bloco contínuo', () => {
        expect(resolveCollectRequest(31155)).toEqual({ initialNsr: 31156, requestedFrom: 'nsr:31156' });
    });
});

describe('pickContract', () => {
    test('prefere o contrato ativo mais recente', () => {
        const rows = [
            { id: 'a', admittedAt: '2020-01-01', dismissedAt: '2023-05-01' },
            { id: 'b', admittedAt: '2023-06-01', dismissedAt: null },
        ];
        expect(pickContract(rows).id).toBe('b');
    });
    test('sem ativo, o último desligamento', () => {
        const rows = [
            { id: 'a', admittedAt: '2020-01-01', dismissedAt: '2021-05-01' },
            { id: 'b', admittedAt: '2022-01-01', dismissedAt: '2026-08-15' },
        ];
        expect(pickContract(rows).id).toBe('b');
    });
    test('datas do Protheus', () => {
        expect(normalizeProtheusDate('20260815')).toBe('2026-08-15');
        expect(normalizeProtheusDate('        ')).toBeNull();
        expect(normalizeProtheusDate('')).toBeNull();
    });
});
