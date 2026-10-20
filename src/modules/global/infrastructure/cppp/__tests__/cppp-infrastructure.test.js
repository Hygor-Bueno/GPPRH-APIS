/**
 * Infraestrutura do CPPP sem rede e sem banco:
 * - AFD bruto em disco byte a byte (CRLF intacto), sem sobrescrever, com hash;
 * - cliente do relógio: rotas, sessão na query string, logout best-effort;
 * - guard: nenhum código escreve em `cppp_afd_records` além do INSERT da carga.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { FsCpppRawAfdStorage } = require('../fs-cppp-raw-afd.storage');
const { ControlIdClockClient } = require('../controlid-clock.client');

describe('FsCpppRawAfdStorage', () => {
    let root;
    beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cppp-')); });
    afterEach(() => {
        // Arquivos são gravados 0o444; devolve escrita para conseguir limpar.
        for (const file of walk(root)) fs.chmodSync(file, 0o644);
        fs.rmSync(root, { recursive: true, force: true });
    });

    function walk(dir) {
        return fs.readdirSync(dir, { withFileTypes: true })
            .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    }

    const now = () => new Date(2026, 9, 8, 2, 0, 5);

    test('grava exatamente os bytes recebidos — CRLF não vira CR CR LF', async () => {
        const storage = new FsCpppRawAfdStorage({ root, now });
        const buffer = Buffer.from('000000001...\r\n000000002...\r\nAFD...REP_C.txt\r\n', 'latin1');
        const saved = await storage.save({ deviceCode: 'INTERLAGOS', runId: 7, buffer });

        expect(saved.relativePath).toBe('afd/INTERLAGOS/2026/10/afd_INTERLAGOS_run7_20261008_020005.txt');
        expect(fs.readFileSync(path.join(root, saved.relativePath)).equals(buffer)).toBe(true);
        expect(saved.bytes).toBe(buffer.length);
        expect(saved.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    test('nunca sobrescreve um AFD já gravado', async () => {
        const storage = new FsCpppRawAfdStorage({ root, now });
        await storage.save({ deviceCode: 'INTERLAGOS', runId: 7, buffer: Buffer.from('a') });
        await expect(storage.save({ deviceCode: 'INTERLAGOS', runId: 7, buffer: Buffer.from('b') }))
            .rejects.toThrow(/Nada foi carregado/);
    });

    test('download confere o hash; arquivo adulterado não é entregue', async () => {
        const storage = new FsCpppRawAfdStorage({ root, now });
        const saved = await storage.save({ deviceCode: 'INTERLAGOS', runId: 1, buffer: Buffer.from('original') });
        await expect(storage.resolve(saved.relativePath, saved.sha256)).resolves.toMatchObject({ fileName: path.basename(saved.relativePath) });

        const file = path.join(root, saved.relativePath);
        fs.chmodSync(file, 0o644);
        fs.writeFileSync(file, 'adulterado');
        await expect(storage.resolve(saved.relativePath, saved.sha256)).rejects.toMatchObject({ code: 'CPPP_RAW_HASH_MISMATCH' });
    });

    test('caminho fora da raiz é recusado', async () => {
        const storage = new FsCpppRawAfdStorage({ root, now });
        await expect(storage.resolve('../../etc/passwd', null)).rejects.toMatchObject({ statusCode: 400 });
    });
});

describe('ControlIdClockClient', () => {
    const device = { code: 'INTERLAGOS', base_url: 'https://192.168.10.28/' };
    const config = { verifyTls: false, timeoutMs: 180000, afdMode: 671 };
    const credentials = () => ({ login: 'admin', password: 'segredo' });

    function fakeHttp({ afdStatus = 200, logoutFails = false } = {}) {
        return {
            post: jest.fn(async (url, body, options) => {
                if (url.endsWith('/login.fcgi')) return { status: 200, data: { session: 'abc' } };
                if (url.endsWith('/get_afd.fcgi')) return { status: afdStatus, data: Buffer.from('000000001...\r\n') };
                if (url.endsWith('/logout.fcgi')) {
                    if (logoutFails) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
                    return { status: 200, data: {} };
                }
                throw new Error(`rota inesperada ${url}`);
            }),
        };
    }

    test('login → get_afd (sessão na query, modo 671) → logout; corpo devolvido como Buffer intocado', async () => {
        const http = fakeHttp();
        const client = new ControlIdClockClient({ config, credentials, http });
        const buffer = await client.fetchAfd(device, { initialNsr: 31156 });

        expect(buffer.toString()).toBe('000000001...\r\n');
        const [login, getAfd, logout] = http.post.mock.calls;
        expect(login[0]).toBe('https://192.168.10.28/login.fcgi');
        expect(login[1]).toEqual({ login: 'admin', password: 'segredo' });
        expect(getAfd[1]).toEqual({ initial_nsr: 31156 });
        // insecureHTTPParser: o REP-C responde cabeçalho HTTP com LF sem CR.
        expect(getAfd[2]).toMatchObject({ params: { session: 'abc', mode: 671 }, responseType: 'arraybuffer', proxy: false, insecureHTTPParser: true });
        expect(login[2].insecureHTTPParser).toBe(true);
        expect(getAfd[2].httpsAgent.options.rejectUnauthorized).toBe(false);
        expect(logout[2].params).toEqual({ session: 'abc' });
    });

    test('AFD integral manda corpo vazio', async () => {
        const http = fakeHttp();
        await new ControlIdClockClient({ config, credentials, http }).fetchAfd(device, { initialNsr: null });
        expect(http.post.mock.calls[1][1]).toEqual({});
    });

    test('falha de logout é engolida (best-effort, como no ETL)', async () => {
        const http = fakeHttp({ logoutFails: true });
        await expect(new ControlIdClockClient({ config, credentials, http }).fetchAfd(device, {})).resolves.toBeInstanceOf(Buffer);
    });

    test('HTTP de erro vira 502 com a rota, e o logout ainda acontece', async () => {
        const http = fakeHttp({ afdStatus: 401 });
        await expect(new ControlIdClockClient({ config, credentials, http }).fetchAfd(device, {}))
            .rejects.toMatchObject({ statusCode: 502, code: 'CPPP_DEVICE_HTTP' });
        expect(http.post.mock.calls.at(-1)[0]).toMatch(/logout/);
    });

    test('sem senha configurada não chama o relógio', async () => {
        const http = fakeHttp();
        const client = new ControlIdClockClient({ config, credentials: () => ({ login: 'admin', password: '' }), http });
        await expect(client.fetchAfd(device, {})).rejects.toThrow(/CPPP_DEVICE_PASSWORD/);
        expect(http.post).not.toHaveBeenCalled();
    });

    test('cada chamada abre e fecha a sessão — nada é reaproveitado entre coletas', async () => {
        const http = fakeHttp();
        const client = new ControlIdClockClient({ config, credentials, http });
        await client.fetchAfd(device, {});
        await client.fetchAfd(device, {});

        const paths = http.post.mock.calls.map(([url]) => url.split('/').pop());
        expect(paths).toEqual(['login.fcgi', 'get_afd.fcgi', 'logout.fcgi', 'login.fcgi', 'get_afd.fcgi', 'logout.fcgi']);
        // Um agent novo por chamada, sem keep-alive: nenhum socket sobrevive.
        const agents = http.post.mock.calls.map(([, , options]) => options.httpsAgent);
        expect(agents[0]).toBe(agents[2]);
        expect(agents[0]).not.toBe(agents[3]);
        expect(agents[0].keepAlive).toBe(false);
    });

    test('testConnection: só login e logout, com o timeout curto', async () => {
        const http = fakeHttp();
        const client = new ControlIdClockClient({ config: { ...config, testTimeoutMs: 15000 }, credentials, http });
        const result = await client.testConnection({ base_url: 'https://192.168.10.30' });

        expect(result.ok).toBe(true);
        expect(http.post.mock.calls.map(([url]) => url)).toEqual(['https://192.168.10.30/login.fcgi', 'https://192.168.10.30/logout.fcgi']);
        expect(http.post.mock.calls.every(([, , options]) => options.timeout === 15000)).toBe(true);
    });

    test('a mesma credencial serve para qualquer relógio', async () => {
        const http = fakeHttp();
        const credentialsSpy = jest.fn(() => ({ login: 'admin', password: 'segredo' }));
        const client = new ControlIdClockClient({ config, credentials: credentialsSpy, http });
        await client.testConnection({ code: 'A', base_url: 'https://192.168.10.30' });
        await client.testConnection({ code: 'B', base_url: 'https://192.168.20.40' });
        expect(http.post.mock.calls.filter(([url]) => url.endsWith('login.fcgi')).map(([, body]) => body))
            .toEqual([{ login: 'admin', password: 'segredo' }, { login: 'admin', password: 'segredo' }]);
    });

    test('certificado autoassinado com verificação ligada explica o que fazer', async () => {
        const http = { post: jest.fn(async () => { throw Object.assign(new Error('self signed'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }); }) };
        const client = new ControlIdClockClient({ config: { ...config, verifyTls: true }, credentials, http });
        await expect(client.fetchAfd(device, {})).rejects.toThrow(/CPPP_VERIFY_TLS=false/);
    });
});

describe('guard — cppp_afd_records só recebe INSERT', () => {
    const SRC = path.resolve(__dirname, '../../../../..');

    function sources(dir) {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === '__tests__' ? [] : sources(full);
            return entry.name.endsWith('.js') ? [full] : [];
        });
    }

    test('nenhum UPDATE, DELETE, REPLACE ou TRUNCATE em cppp_afd_records no código', () => {
        const forbidden = /(UPDATE\s+`?cppp_afd_records|DELETE\s+(\w+\s+)?FROM\s+`?cppp_afd_records|REPLACE\s+INTO\s+`?cppp_afd_records|TRUNCATE\s+(TABLE\s+)?`?cppp_afd_records|ON\s+DUPLICATE\s+KEY)/i;
        const offenders = sources(SRC)
            .filter((file) => /cppp/i.test(fs.readFileSync(file, 'utf8')))
            .filter((file) => forbidden.test(fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
        expect(offenders).toEqual([]);
    });

    test('nenhuma rota de escrita contra o relógio além de login/get_afd/logout', () => {
        const client = fs.readFileSync(path.join(__dirname, '..', 'controlid-clock.client.js'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
        const routes = [...client.matchAll(/'(\/[a-z_]+\.fcgi)'/g)].map((m) => m[1]).sort();
        expect(routes).toEqual(['/get_afd.fcgi', '/login.fcgi', '/logout.fcgi']);
    });
});
