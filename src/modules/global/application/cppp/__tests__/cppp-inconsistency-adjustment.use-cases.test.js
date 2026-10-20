/**
 * Tela de tratamento: o dia corrente nunca aparece, a ocorrência sai da lista
 * quando o ajuste certo entra, e o ajuste exige autoria e leitura válida.
 */

const { CpppInconsistencyUseCases } = require('../inconsistency/cppp-inconsistency.use-cases');
const { CpppAdjustmentUseCases } = require('../adjustment/cppp-adjustment.use-cases');

const CPF = '52998224725';
const RULES = { duplicateWindowMinutes: 3, earlyCloseMinutes: 90, minBaselineDays: 5 };
const CONFIG = { rules: RULES, baselineDays: 60, maxPeriodDays: 92 };
const NOW = () => new Date('2026-10-08T10:00:00');

function punchesOf(day, times, cpf = CPF, startNsr = 1) {
    return times.map((time, i) => ({ deviceId: 1, nsr: startNsr + i, cpf, day, time: `${time}:00` }));
}

function setup({ punches = [], adjustments = [], lastSuccessAt = '2026-10-08T02:00:05' } = {}) {
    const stored = [...adjustments];
    const afd = {
        findPunches: jest.fn(async ({ from, to, cpf }) =>
            punches.filter((p) => p.day >= from && p.day <= to && (!cpf || p.cpf === cpf))),
        findDayPunches: jest.fn(async (cpf, day) => punches
            .filter((p) => p.cpf === cpf && p.day === day)
            .map((p) => ({ device_id: p.deviceId, nsr: p.nsr, time: p.time }))),
        clockNames: jest.fn(async () => new Map()),
        findRecord: jest.fn(async (deviceId, nsr) => {
            const p = punches.find((x) => x.deviceId === deviceId && x.nsr === nsr);
            return p ? { deviceId, nsr, recordType: 3, cpf: p.cpf, day: p.day } : null;
        }),
    };
    const adjRepo = {
        findActiveInRange: jest.fn(async () => stored.filter((a) => !a.canceledAt)),
        findForDay: jest.fn(async () => stored),
        insert: jest.fn(async (a, createdBy) => { stored.push({ ...a, id: stored.length + 1, createdBy }); return stored.length; }),
        findById: jest.fn(async (id) => stored.find((a) => a.id === id) ?? null),
    };
    const runs = { lastSuccessByDevice: jest.fn(async () => [{ deviceId: 1, lastSuccessAt }]) };
    const directory = { findByIdentifiers: jest.fn(async () => new Map()) };

    const inconsistency = new CpppInconsistencyUseCases({
        afd, adjustments: adjRepo, runs, directory, config: CONFIG, now: NOW, logger: { warn: jest.fn() },
    });
    const attachments = { save: jest.fn(async () => ({ fileId: 77, mimeType: 'application/pdf' })) };
    const adjustment = new CpppAdjustmentUseCases({
        adjustments: adjRepo, afd, attachments, inconsistency, config: CONFIG, now: NOW,
    });
    return { inconsistency, adjustment, adjRepo, directory, attachments };
}

describe('lista de inconsistências', () => {
    test('o dia corrente nunca aparece, mesmo pedido explicitamente', async () => {
        const punches = [...punchesOf('2026-10-07', ['08:00']), ...punchesOf('2026-10-08', ['08:00'], CPF, 10)];
        const { inconsistency } = setup({ punches });
        const result = await inconsistency.list({ from: '2026-10-01', to: '2026-10-08' });
        expect(result.window.to).toBe('2026-10-07');
        expect(result.items.map((i) => i.day)).toEqual(['2026-10-07']);
    });

    test('coleta atrasada corta antes de ontem', async () => {
        const { inconsistency } = setup({ punches: punchesOf('2026-10-07', ['08:00']), lastSuccessAt: '2026-10-05T02:00:00' });
        const result = await inconsistency.list({ from: '2026-10-01', to: '2026-10-07' });
        expect(result.window.cutoff).toBe('2026-10-04');
        expect(result.items).toEqual([]);
    });

    test('sem coleta concluída, diz isso em vez de lista vazia muda', async () => {
        const { inconsistency } = setup({ lastSuccessAt: null });
        const result = await inconsistency.list({});
        expect(result.window.no_collection).toBe(true);
    });

    test('identificador inválido (12345678912) fica fora; PIS entra', async () => {
        const punches = [
            ...punchesOf('2026-10-06', ['08:00'], '12345678912'),
            ...punchesOf('2026-10-06', ['08:00'], '12834651819', 20),
        ];
        const { inconsistency } = setup({ punches });
        const result = await inconsistency.list({ from: '2026-10-06', to: '2026-10-06' });
        expect(result.items.map((i) => i.cpf)).toEqual(['12834651819']);
    });

    test('Protheus fora do ar não derruba a tela', async () => {
        const { inconsistency, directory } = setup({ punches: punchesOf('2026-10-06', ['08:00']) });
        directory.findByIdentifiers.mockRejectedValueOnce(new Error('ETIMEOUT'));
        const result = await inconsistency.list({ from: '2026-10-06', to: '2026-10-06' });
        expect(result.employee_lookup_failed).toBe(true);
        expect(result.items).toHaveLength(1);
    });

    test('filtros e paginação', async () => {
        const punches = [];
        for (let d = 1; d <= 6; d++) punches.push(...punchesOf(`2026-10-0${d}`, ['08:00'], CPF, d * 10));
        const { inconsistency } = setup({ punches });
        const page = await inconsistency.list({ from: '2026-10-01', to: '2026-10-07', limit: 2, page: 2 });
        expect(page.pagination).toMatchObject({ total: 6, pages: 3, page: 2 });
        expect(page.items.map((i) => i.day)).toEqual(['2026-10-03', '2026-10-04']);
        await expect(inconsistency.list({ issue: 'outra' })).rejects.toMatchObject({ statusCode: 400 });
    });
});

describe('lançar ajuste e ver a ocorrência sair da lista', () => {
    test('batida esquecida resolve o dia ímpar, e a resposta já traz o dia recalculado', async () => {
        const { inconsistency, adjustment } = setup({ punches: punchesOf('2026-10-06', ['08:00', '12:00', '13:00']) });
        expect((await inconsistency.list({ from: '2026-10-06', to: '2026-10-06' })).items).toHaveLength(1);

        const result = await adjustment.create({
            input: { type: 'batida_esquecida', cpf: CPF, punch_at: '2026-10-06T17:00', reason: 'Esqueceu a saída' },
            actor: { id: 5 },
        });

        expect(result.adjustment).toMatchObject({ type: 'batida_esquecida', created_by: 5, status: 'ativo' });
        expect(result.day.findings.map((f) => f.status)).toEqual(['tratada']);
        expect((await inconsistency.list({ from: '2026-10-06', to: '2026-10-06' })).items).toEqual([]);
        expect((await inconsistency.list({ from: '2026-10-06', to: '2026-10-06', status: 'tratada' })).items).toHaveLength(1);
    });

    test('sem usuário na sessão não há ajuste', async () => {
        const { adjustment } = setup();
        await expect(adjustment.create({ input: {}, actor: null })).rejects.toMatchObject({ statusCode: 401 });
    });

    test('desconsiderar leitura de OUTRA pessoa é recusado', async () => {
        const punches = punchesOf('2026-10-06', ['08:00', '08:01'], '12834651819');
        const { adjustment } = setup({ punches });
        await expect(adjustment.create({
            input: { type: 'desconsiderar_leitura', cpf: CPF, device_id: 1, nsr: 2, work_date: '2026-10-06', reason: 'duplicada' },
            actor: { id: 5 },
        })).rejects.toThrow(/não é desta pessoa/);
    });

    test('anexo que não é PDF nem imagem é recusado antes de gravar', async () => {
        const { adjustment, attachments } = setup();
        await expect(adjustment.create({
            input: { type: 'atestado', cpf: CPF, period_start: '2026-10-06', period_end: '2026-10-06', reason: 'Atestado médico' },
            file: { mimetype: 'application/zip' },
            actor: { id: 5 },
        })).rejects.toMatchObject({ statusCode: 400 });
        expect(attachments.save).not.toHaveBeenCalled();
    });

    test('atestado com PDF guarda o anexo e justifica o dia', async () => {
        const { adjustment, adjRepo } = setup({ punches: punchesOf('2026-10-06', ['08:00']) });
        const result = await adjustment.create({
            input: { type: 'atestado', cpf: CPF, period_start: '2026-10-06', period_end: '2026-10-06', reason: 'Atestado médico' },
            file: { mimetype: 'application/pdf' },
            actor: { id: 5 },
        });
        expect(adjRepo.insert.mock.calls[0][0].attachmentFileId).toBe(77);
        expect(result.adjustment.has_attachment).toBe(true);
        expect(result.day.findings.every((f) => f.status === 'tratada')).toBe(true);
    });
});
