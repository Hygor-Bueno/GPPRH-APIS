/**
 * Coleta: idempotência, conflito, buraco de NSR, identidade do REP, bruto
 * gravado antes do parse. Repositórios em memória — nunca o banco real.
 */

const { CpppCollectUseCases } = require('../collect/cppp-collect.use-cases');

const FOOTER = 'AFD0001400375038456360479680001252REP_C.txt';
const line = (nsr, time = '08:00', cpf = '010622338908') =>
    `${String(nsr).padStart(9, '0')}3` + `2026-08-20T${time}:00-0300` + `${cpf}ab12`;
const afd = (...lines) => Buffer.from([...lines, FOOTER, ''].join('\r\n'), 'utf8');

const DEVICE = { id: 1, code: 'INTERLAGOS', active: 1, rep_number: '00014003750384563', base_url: 'https://x' };

/** Espelho em memória com a mesma semântica da tabela: só INSERT. */
function memoryAfd() {
    const rows = new Map();
    return {
        rows,
        lastContiguousNsr: jest.fn(async () => {
            const nsrs = [...rows.keys()].sort((a, b) => a - b);
            if (!nsrs.length) return null;
            for (let i = 0; i < nsrs.length; i++) if (!rows.has(nsrs[i] + 1)) return nsrs[i];
            return nsrs[nsrs.length - 1];
        }),
        findRawLines: jest.fn(async (deviceId, min, max) =>
            new Map([...rows].filter(([nsr]) => nsr >= min && nsr <= max).map(([nsr, r]) => [nsr, r.rawLine]))),
        insertRecords: jest.fn(async (deviceId, runId, records) => {
            for (const r of records) {
                if (rows.has(r.nsr)) throw new Error('ER_DUP_ENTRY');
                rows.set(r.nsr, r);
            }
            return records.length;
        }),
    };
}

function setup({ responses = [], existing = [], device = DEVICE, otherDevices = [] } = {}) {
    const afdRepo = memoryAfd();
    for (const r of existing) afdRepo.rows.set(r.nsr, r);

    const finished = [];
    const runs = {
        claim: jest.fn(async () => true),
        setRequestedFrom: jest.fn(),
        finish: jest.fn(async (id, result) => finished.push(result)),
        enqueue: jest.fn(async () => 10),
        findById: jest.fn(async (id) => ({ id, status: 'queued' })),
        findActive: jest.fn(async () => ({ id: 9, status: 'running' })),
        nextQueued: jest.fn(async () => null),
        failStuck: jest.fn(async () => 0),
        lastScheduledAt: jest.fn(async () => null),
    };
    const devices = {
        findById: jest.fn(async () => device),
        listActive: jest.fn(async () => [device]),
        findByRepNumber: jest.fn(async (rep) => [device, ...otherDevices].find((d) => d.rep_number === rep) ?? null),
        setRepNumberIfEmpty: jest.fn(),
        insert: jest.fn(async () => 2),
        update: jest.fn(),
        hasRecords: jest.fn(async () => true),
    };
    const clock = { fetchAfd: jest.fn(), testConnection: jest.fn(async () => ({ ok: true, elapsedMs: 40 })) };
    for (const body of responses) clock.fetchAfd.mockResolvedValueOnce(body);
    const saved = [];
    const rawStorage = {
        save: jest.fn(async ({ buffer }) => {
            saved.push(Buffer.from(buffer));
            return { relativePath: `afd/INTERLAGOS/run${saved.length}.txt`, sha256: 'h', bytes: buffer.length };
        }),
    };

    const useCases = new CpppCollectUseCases({
        runs, devices, afd: afdRepo, clock, rawStorage,
        config: { collectTime: '02:00', stuckRunMinutes: 30, allowedNetworks: ['192.168.0.0/16'] },
        now: () => new Date('2026-10-08T03:00:00'),
    });
    return { useCases, runs, afdRepo, clock, rawStorage, finished, saved, devices };
}

describe('execute — carga', () => {
    test('primeira coleta pede o AFD integral e grava tudo', async () => {
        const { useCases, finished, clock, runs } = setup({ responses: [afd(line(1), line(2, '12:00'))] });
        await useCases.execute({ id: 1, device_id: 1 });

        expect(clock.fetchAfd).toHaveBeenCalledWith(DEVICE, { initialNsr: null });
        expect(runs.setRequestedFrom).toHaveBeenCalledWith(1, 'full');
        expect(finished[0]).toMatchObject({ status: 'success', extracted: 2, inserted: 2, identical: 0, rejected: 0, firstNsr: 1, lastNsr: 2 });
    });

    test('reimportar o mesmo AFD não altera nada', async () => {
        const body = afd(line(1), line(2, '12:00'));
        const { useCases, finished, afdRepo } = setup({ responses: [body, body] });
        await useCases.execute({ id: 1, device_id: 1 });
        const snapshot = JSON.stringify([...afdRepo.rows]);

        await useCases.execute({ id: 2, device_id: 1 });

        expect(finished[1]).toMatchObject({ status: 'success', inserted: 0, identical: 2 });
        expect(JSON.stringify([...afdRepo.rows])).toBe(snapshot);
        expect(afdRepo.insertRecords).toHaveBeenCalledTimes(1);
    });

    test('incremental pede do NSR seguinte ao último contínuo', async () => {
        const { useCases, clock, afdRepo } = setup({ responses: [afd(line(1), line(2)), afd(line(3))] });
        await useCases.execute({ id: 1, device_id: 1 });
        await useCases.execute({ id: 2, device_id: 1 });
        expect(clock.fetchAfd).toHaveBeenLastCalledWith(DEVICE, { initialNsr: 3 });
        expect([...afdRepo.rows.keys()]).toEqual([1, 2, 3]);
    });

    test('NSR já gravado com outra linha: conflito, espelho intocado, coleta failed', async () => {
        const original = { nsr: 1, rawLine: line(1, '08:00') };
        const { useCases, finished, afdRepo } = setup({ responses: [afd(line(1, '09:00'), line(2))], existing: [original] });
        await useCases.execute({ id: 1, device_id: 1 });

        expect(afdRepo.rows.get(1)).toBe(original);
        expect(finished[0]).toMatchObject({ status: 'failed', conflicts: 1 });
        expect(finished[0].error).toMatch(/NÃO foi alterado/);
    });

    test('buraco no NSR: grava o que veio, termina failed e a próxima pede de novo do buraco', async () => {
        const { useCases, finished, clock } = setup({ responses: [afd(line(1), line(2), line(5)), afd(line(3), line(4), line(5))] });
        await useCases.execute({ id: 1, device_id: 1 });
        expect(finished[0]).toMatchObject({ status: 'failed', inserted: 3 });
        expect(finished[0].error).toMatch(/3–4/);

        await useCases.execute({ id: 2, device_id: 1 });
        expect(clock.fetchAfd).toHaveBeenLastCalledWith(DEVICE, { initialNsr: 3 });
        expect(finished[1]).toMatchObject({ status: 'success', inserted: 2, identical: 1 });
    });

    test('AFD de outro REP não grava nada', async () => {
        const other = Buffer.from([line(1), 'AFD9999999999999999960479680001252REP_C.txt'].join('\r\n'));
        const { useCases, finished, afdRepo } = setup({ responses: [other] });
        await useCases.execute({ id: 1, device_id: 1 });
        expect(afdRepo.rows.size).toBe(0);
        expect(finished[0].status).toBe('failed');
        expect(finished[0].error).toMatch(/REP 99999999999999999/);
    });

    test('o bruto é gravado byte a byte e ANTES do parse — mesmo quando o parse acusa erro', async () => {
        const body = Buffer.from(`${line(1)}\r\n${line(2)}\r\nlixo\r\n${FOOTER}\r\n`, 'utf8');
        const { useCases, saved, finished } = setup({ responses: [body] });
        await useCases.execute({ id: 1, device_id: 1 });
        expect(saved[0].equals(body)).toBe(true);
        expect(finished[0]).toMatchObject({ rawFilePath: 'afd/INTERLAGOS/run1.txt', rawBytes: body.length, rejected: 1 });
        expect(finished[0].warnings).toMatch(/não reconhecida/);
    });

    test('trailer divergente é aviso, não falha (comportamento no incremental ainda não observado)', async () => {
        const trailer = '999999999' + '000000000' + '000000005' + '000000000'.repeat(4) + '9';
        const { useCases, finished } = setup({ responses: [afd(line(1), trailer)] });
        await useCases.execute({ id: 1, device_id: 1 });
        expect(finished[0]).toMatchObject({ status: 'success', trailerCheck: 'mismatch' });
        expect(finished[0].warnings).toMatch(/trailer/);
    });

    test('relógio fora do ar: failed com a mensagem, sem arquivo', async () => {
        const { useCases, finished, clock } = setup();
        clock.fetchAfd.mockRejectedValueOnce(new Error('Falha de comunicação com o relógio INTERLAGOS (ETIMEDOUT)'));
        await useCases.execute({ id: 1, device_id: 1 });
        expect(finished[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/ETIMEDOUT/) });
        expect(finished[0].rawFilePath).toBeUndefined();
    });

    test('coleta que outro processo já pegou não roda', async () => {
        const { useCases, runs, clock } = setup();
        runs.claim.mockResolvedValueOnce(false);
        expect(await useCases.execute({ id: 1, device_id: 1 })).toBeNull();
        expect(clock.fetchAfd).not.toHaveBeenCalled();
    });
});

describe('fila e agenda', () => {
    test('disparo pela tela com coleta viva é 409', async () => {
        const { useCases, runs } = setup();
        runs.enqueue.mockResolvedValueOnce(null);
        await expect(useCases.requestCollect({ deviceId: 1, actor: { id: 3 } })).rejects.toMatchObject({ statusCode: 409 });
    });

    test('disparo pela tela registra quem pediu', async () => {
        const { useCases, runs } = setup();
        await useCases.requestCollect({ deviceId: 1, actor: { id: 3 } });
        expect(runs.enqueue).toHaveBeenCalledWith({ deviceId: 1, trigger: 'manual', requestedBy: 3 });
    });

    test('depois das 02:00 sem coleta agendada hoje, enfileira a diária', async () => {
        const { useCases, runs } = setup();
        expect(await useCases.enqueueDue()).toBe(1);
        expect(runs.enqueue).toHaveBeenCalledWith({ deviceId: 1, trigger: 'schedule', requestedBy: null });
    });

    test('a diária de hoje já existe: não repete', async () => {
        const { useCases, runs } = setup();
        runs.lastScheduledAt.mockResolvedValueOnce('2026-10-08T02:00:04');
        expect(await useCases.enqueueDue()).toBe(0);
        expect(runs.enqueue).not.toHaveBeenCalled();
    });
});

describe('relógios cadastrados pela tela', () => {
    test('relógio sem REP aprende o número na primeira coleta', async () => {
        const fresh = { ...DEVICE, id: 3, code: 'LOJA_02', rep_number: null };
        const { useCases, devices, finished } = setup({ device: fresh, responses: [afd(line(1))] });
        await useCases.execute({ id: 1, device_id: 3 });
        expect(devices.setRepNumberIfEmpty).toHaveBeenCalledWith(3, '00014003750384563');
        expect(finished[0].status).toBe('success');
    });

    test('dois cadastros para o mesmo equipamento: a coleta não grava nada', async () => {
        const duplicate = { ...DEVICE, id: 3, code: 'LOJA_02', rep_number: null };
        const { useCases, afdRepo, finished } = setup({ device: duplicate, otherDevices: [DEVICE], responses: [afd(line(1))] });
        await useCases.execute({ id: 1, device_id: 3 });
        expect(afdRepo.rows.size).toBe(0);
        expect(finished[0].status).toBe('failed');
        expect(finished[0].error).toMatch(/já está cadastrado como o relógio INTERLAGOS/);
    });

    test('cadastro registra o autor e normaliza o IP', async () => {
        const { useCases, devices } = setup();
        await useCases.createDevice({ input: { code: 'loja_02', name: 'Loja 2', base_url: '192.168.20.15' }, actor: { id: 4 } });
        expect(devices.insert).toHaveBeenCalledWith({ code: 'LOJA_02', name: 'Loja 2', baseUrl: 'https://192.168.20.15' }, 4);
    });

    test('IP fora da rede interna é recusado antes de qualquer chamada', async () => {
        const { useCases, clock, devices } = setup();
        await expect(useCases.createDevice({ input: { code: 'X1', name: 'Fora', base_url: '8.8.8.8' }, actor: { id: 4 } }))
            .rejects.toMatchObject({ statusCode: 400 });
        await expect(useCases.testAddress('8.8.8.8')).rejects.toMatchObject({ statusCode: 400 });
        expect(devices.insert).not.toHaveBeenCalled();
        expect(clock.testConnection).not.toHaveBeenCalled();
    });

    test('trocar o IP do relógio é edição comum', async () => {
        const { useCases, devices } = setup();
        await useCases.updateDevice({ id: 1, input: { base_url: '192.168.10.99' }, actor: { id: 4 } });
        expect(devices.update).toHaveBeenCalledWith(1, { baseUrl: 'https://192.168.10.99' }, 4);
    });

    test('trocar o REP de relógio com registros é 409', async () => {
        const { useCases, devices } = setup();
        await expect(useCases.updateDevice({ id: 1, input: { rep_number: '99999999999999999' }, actor: { id: 4 } }))
            .rejects.toMatchObject({ statusCode: 409 });
        expect(devices.update).not.toHaveBeenCalled();
    });

    test('teste de conexão: falha é resultado (ok: false), não erro da API', async () => {
        const { useCases, clock } = setup();
        clock.testConnection.mockRejectedValueOnce(new Error('Falha de comunicação com o relógio INTERLAGOS (ETIMEDOUT)'));
        await expect(useCases.testDevice(1)).resolves.toMatchObject({ ok: false, message: expect.stringMatching(/ETIMEDOUT/) });
        await expect(useCases.testAddress('192.168.10.28')).resolves.toMatchObject({ ok: true, base_url: 'https://192.168.10.28' });
    });
});
