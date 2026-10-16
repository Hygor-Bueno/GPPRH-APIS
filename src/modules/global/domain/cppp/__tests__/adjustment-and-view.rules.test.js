const { normalizeAdjustment, coveredDays } = require('../adjustment/adjustment.rules');
const { applyAdjustments, classifyFindings } = require('../inconsistency/treated-view.rules');
const { analyse } = require('../inconsistency/punch-inconsistency.rules');
const { isValidCpf, isValidPis, identifierKind } = require('../cpf.rules');

const CPF = '52998224725'; // válido
const OPTIONS = { today: '2026-10-08', maxPeriodDays: 60 };

describe('isValidCpf', () => {
    test('CPF de teste cadastrado no relógio é inválido', () => {
        expect(isValidCpf('12345678912')).toBe(false);
    });
    test('CPF válido, com ou sem máscara', () => {
        expect(isValidCpf(CPF)).toBe(true);
        expect(isValidCpf('529.982.247-25')).toBe(true);
    });
    test('repetidos e tamanho errado', () => {
        expect(isValidCpf('11111111111')).toBe(false);
        expect(isValidCpf('123')).toBe(false);
        expect(isValidCpf(null)).toBe(false);
    });
});

describe('identifierKind — o campo CPF do relógio guarda CPF ou PIS', () => {
    test('PIS real do cadastro do relógio é aceito', () => {
        expect(isValidPis('12834651819')).toBe(true);
        expect(identifierKind('12834651819')).toBe('pis');
    });
    test('CPF', () => {
        expect(identifierKind(CPF)).toBe('cpf');
    });
    test('sequência de teste não é nenhum dos dois', () => {
        expect(identifierKind('12345678912')).toBe('invalido');
    });
});

describe('normalizeAdjustment', () => {
    const base = { cpf: CPF, reason: 'Esqueceu de bater a saída' };

    test('batida esquecida: dia vem da própria batida', () => {
        const adj = normalizeAdjustment({ ...base, type: 'batida_esquecida', punch_at: '2026-08-20T17:10' }, OPTIONS);
        expect(adj).toMatchObject({ punchAt: '2026-08-20 17:10:00', workDate: '2026-08-20' });
    });

    test('desconsiderar leitura exige equipamento, NSR e dia', () => {
        expect(() => normalizeAdjustment({ ...base, type: 'desconsiderar_leitura', nsr: 10 }, OPTIONS)).toThrow(/device_id/);
        const adj = normalizeAdjustment({ ...base, type: 'desconsiderar_leitura', device_id: '1', nsr: '31156', work_date: '2026-08-20' }, OPTIONS);
        expect(adj).toMatchObject({ deviceId: 1, nsr: 31156, workDate: '2026-08-20' });
    });

    test('atestado aceita período OU intervalo, nunca os dois', () => {
        expect(normalizeAdjustment({ ...base, type: 'atestado', period_start: '2026-08-20', period_end: '2026-08-22' }, OPTIONS))
            .toMatchObject({ periodStart: '2026-08-20', periodEnd: '2026-08-22', workDate: '2026-08-20' });
        expect(normalizeAdjustment({ ...base, type: 'atestado', starts_at: '2026-08-20 08:00', ends_at: '2026-08-20 10:00' }, OPTIONS))
            .toMatchObject({ workDate: '2026-08-20', startsAt: '2026-08-20 08:00:00' });
        expect(() => normalizeAdjustment({
            ...base, type: 'atestado', period_start: '2026-08-20', period_end: '2026-08-20', starts_at: '2026-08-20 08:00', ends_at: '2026-08-20 10:00',
        }, OPTIONS)).toThrow(/um dos dois/);
    });

    test('campo de outra forma é recusado em vez de ignorado', () => {
        expect(() => normalizeAdjustment({ ...base, type: 'ferias', period_start: '2026-08-01', period_end: '2026-08-10', punch_at: '2026-08-01 08:00' }, OPTIONS))
            .toThrow(/punch_at/);
    });

    test('dia da ocorrência precisa estar dentro do período', () => {
        expect(() => normalizeAdjustment({ ...base, type: 'folga', period_start: '2026-08-01', period_end: '2026-08-02', work_date: '2026-08-05' }, OPTIONS))
            .toThrow(/dentro do período/);
    });

    test('ajuste para quem bate ponto por PIS', () => {
        expect(normalizeAdjustment({ ...base, cpf: '12834651819', type: 'folga', period_start: '2026-08-01', period_end: '2026-08-01' }, OPTIONS).cpf).toBe('12834651819');
    });

    test('limites: CPF inválido, motivo vazio, período longo, dia futuro, intervalo invertido', () => {
        expect(() => normalizeAdjustment({ ...base, cpf: '12345678912', type: 'abono', period_start: '2026-08-01', period_end: '2026-08-01' }, OPTIONS)).toThrow(/Identificador/);
        expect(() => normalizeAdjustment({ ...base, reason: ' ', type: 'folga', period_start: '2026-08-01', period_end: '2026-08-01' }, OPTIONS)).toThrow(/motivo/);
        expect(() => normalizeAdjustment({ ...base, type: 'ferias', period_start: '2026-01-01', period_end: '2026-12-31' }, OPTIONS)).toThrow(/60 dias/);
        expect(() => normalizeAdjustment({ ...base, type: 'batida_esquecida', punch_at: '2026-10-09 08:00' }, OPTIONS)).toThrow(/futuro/);
        expect(() => normalizeAdjustment({ ...base, type: 'declaracao_horas', starts_at: '2026-08-20 10:00', ends_at: '2026-08-20 08:00' }, OPTIONS)).toThrow(/depois/);
    });

    test('férias podem ser lançadas adiantadas', () => {
        expect(() => normalizeAdjustment({ ...base, type: 'ferias', period_start: '2026-11-01', period_end: '2026-11-30' }, OPTIONS)).not.toThrow();
    });

    test('tipo desconhecido', () => {
        expect(() => normalizeAdjustment({ ...base, type: 'hora_extra' }, OPTIONS)).toThrow(/desconhecido/);
    });
});

describe('coveredDays', () => {
    test('período cobre cada dia; intervalo cobre o dia; batida não justifica', () => {
        expect(coveredDays({ type: 'ferias', periodStart: '2026-08-30', periodEnd: '2026-09-01', workDate: '2026-08-30' }))
            .toEqual(['2026-08-30', '2026-08-31', '2026-09-01']);
        expect(coveredDays({ type: 'declaracao_horas', workDate: '2026-08-20' })).toEqual(['2026-08-20']);
        expect(coveredDays({ type: 'batida_esquecida', workDate: '2026-08-20' })).toEqual([]);
    });
});

describe('visão tratada e saída da lista', () => {
    const punch = (time, nsr) => ({ cpf: CPF, day: '2026-08-20', time: `${time}:00`, deviceId: 1, nsr });
    const clock = [punch('08:00', 1), punch('12:00', 2), punch('13:00', 3)]; // ímpar

    function run(adjustments) {
        const raw = analyse(clock);
        const view = applyAdjustments(clock, adjustments);
        return classifyFindings(raw, analyse(view.punches), view.justifiedDays);
    }

    test('sem ajuste, a ocorrência está pendente', () => {
        expect(run([]).map((f) => [f.issue, f.status])).toEqual([['batida_impar', 'pendente']]);
    });

    test('batida esquecida que fecha o par trata a ocorrência', () => {
        const items = run([{ id: 9, type: 'batida_esquecida', cpf: CPF, punchAt: '2026-08-20 17:00:00', workDate: '2026-08-20' }]);
        expect(items.map((f) => [f.issue, f.status])).toEqual([['batida_impar', 'tratada']]);
    });

    test('ajuste errado não esconde nada: o dia continua ímpar', () => {
        const items = run([
            { type: 'batida_esquecida', cpf: CPF, punchAt: '2026-08-20 17:00:00', workDate: '2026-08-20' },
            { type: 'batida_esquecida', cpf: CPF, punchAt: '2026-08-20 18:00:00', workDate: '2026-08-20' },
        ]);
        expect(items.some((f) => f.status === 'pendente' && f.issue === 'batida_impar')).toBe(true);
    });

    test('justificativa trata todas as ocorrências do dia', () => {
        const items = run([{ type: 'atestado', cpf: CPF, workDate: '2026-08-20', startsAt: '2026-08-20 13:30:00', endsAt: '2026-08-20 18:00:00' }]);
        expect(items.every((f) => f.status === 'tratada')).toBe(true);
    });

    test('desconsiderar a leitura duplicada não apaga o registro do relógio, só tira da visão tratada', () => {
        const withDup = [punch('08:00', 1), punch('08:01', 2), punch('12:00', 3), punch('13:00', 4), punch('17:00', 5)];
        const view = applyAdjustments(withDup, [{ type: 'desconsiderar_leitura', cpf: CPF, deviceId: 1, nsr: 2, workDate: '2026-08-20' }]);
        expect(view.punches.map((p) => p.nsr)).toEqual([1, 3, 4, 5]);
        expect(withDup).toHaveLength(5);

        const items = classifyFindings(analyse(withDup), analyse(view.punches), view.justifiedDays);
        expect(items.every((f) => f.status === 'tratada')).toBe(true);
    });
});
