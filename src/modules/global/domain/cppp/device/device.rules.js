/**
 * @fileoverview Cadastro de relógio: forma dos campos e quem pode mudar o quê.
 *
 * Puro; lança `AppError` em entrada inválida.
 *
 * ─── Por que o endereço é restrito a IP da rede interna ──────────────────────
 * Um login e uma senha servem para TODOS os relógios, e o servidor os envia no
 * login para o endereço cadastrado. Sem restrição, quem tem permissão de
 * cadastrar relógio apontaria um "relógio" para um servidor próprio e
 * receberia a senha de todos. Por isso:
 *
 *   - só IP literal (nada de nome: DNS pode apontar para fora depois);
 *   - só dentro de `CPPP_DEVICE_ALLOWED_NETWORKS` (padrão: faixas privadas).
 *
 * Não elimina o risco — alguém na própria rede interna ainda pode subir um
 * servidor num IP privado —, então a permissão `CPPP_COLLECT` deve ficar com
 * poucas pessoas. Ver `docs/cppp.md`.
 *
 * ─── Número do REP ───────────────────────────────────────────────────────────
 * É a identidade física do relógio, declarada por ele no rodapé de cada AFD. O
 * IP pode mudar (troca de rede, DHCP); o REP não. Uma vez que o relógio tem
 * registros no espelho, trocar o REP do cadastro significaria passar a
 * carregar OUTRO equipamento sob o mesmo id — recusado: outro equipamento é
 * outro cadastro.
 *
 * @module modules/global/domain/cppp/device/device.rules
 */

const { AppError } = require('../../../../../errors/app.error');

const CODE_RE = /^[A-Z0-9_]{2,20}$/;
const REP_RE = /^\d{17}$/;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const DEFAULT_ALLOWED_NETWORKS = Object.freeze(['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']);

function fail(message, status = 400) {
    throw new AppError(message, status, { code: 'CPPP_DEVICE_INVALID' });
}

/** `192.168.10.28` → inteiro sem sinal; `null` se não for IPv4 válido. */
function ipv4ToInt(ip) {
    const match = IPV4_RE.exec(String(ip));
    if (!match) return null;
    const parts = match.slice(1).map(Number);
    if (parts.some((part) => part > 255)) return null;
    return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/**
 * @param {string} ip
 * @param {string} cidr - `192.168.0.0/16`
 * @returns {boolean}
 */
function ipInCidr(ip, cidr) {
    const [network, bitsText] = String(cidr).trim().split('/');
    const bits = Number(bitsText);
    const address = ipv4ToInt(ip);
    const base = ipv4ToInt(network);
    if (address === null || base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((address & mask) >>> 0) === ((base & mask) >>> 0);
}

/**
 * Normaliza o endereço do relógio para `https://IP[:porta]`.
 *
 * Aceita `192.168.10.28`, `https://192.168.10.28/`, `192.168.10.28:8443`.
 *
 * @param {string} value
 * @param {string[]} allowedNetworks
 * @returns {string}
 */
function normalizeBaseUrl(value, allowedNetworks = DEFAULT_ALLOWED_NETWORKS) {
    const raw = String(value ?? '').trim();
    if (!raw) fail("Informe o IP do relógio ('base_url').");

    let url;
    try {
        url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
        fail(`Endereço inválido: '${raw}'.`);
    }

    if (!['https:', 'http:'].includes(url.protocol)) fail('O endereço do relógio precisa ser http ou https.');
    if (url.username || url.password) fail('Não coloque usuário ou senha no endereço — a credencial vem do servidor.');
    if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
        fail('Informe só o endereço do relógio, sem caminho (ex.: 192.168.10.28).');
    }
    if (ipv4ToInt(url.hostname) === null) {
        fail('Use o IP do relógio, não um nome (ex.: 192.168.10.28).');
    }
    if (!allowedNetworks.some((cidr) => ipInCidr(url.hostname, cidr))) {
        fail(`O IP ${url.hostname} está fora das redes permitidas para relógio (${allowedNetworks.join(', ')}).`);
    }

    return url.origin;
}

/**
 * @param {object} input - corpo da requisição (snake_case).
 * @param {object} options
 * @param {boolean} options.creating
 * @param {string[]} options.allowedNetworks
 * @returns {{code?: string, name?: string, baseUrl?: string, repNumber?: string|null, active?: boolean}}
 *          só os campos presentes (no update, parcial).
 */
function normalizeDevice(input = {}, { creating, allowedNetworks }) {
    const out = {};
    const has = (field) => input[field] !== undefined;

    if (creating || has('code')) {
        if (!creating) fail("O código do relógio não muda depois de criado — ele está no nome dos arquivos de AFD.");
        const code = String(input.code ?? '').trim().toUpperCase();
        if (!CODE_RE.test(code)) fail("'code': 2 a 20 caracteres, só letras, dígitos e _ (ex.: INTERLAGOS).");
        out.code = code;
    }

    if (creating || has('name')) {
        const name = String(input.name ?? '').trim();
        if (name.length < 2 || name.length > 100) fail("'name': 2 a 100 caracteres.");
        out.name = name;
    }

    if (creating || has('base_url')) out.baseUrl = normalizeBaseUrl(input.base_url, allowedNetworks);

    if (has('rep_number')) {
        const rep = input.rep_number === null || input.rep_number === '' ? null : String(input.rep_number).trim();
        if (rep !== null && !REP_RE.test(rep)) fail("'rep_number': 17 dígitos (está no rodapé do AFD: AFD<17 dígitos>...).");
        out.repNumber = rep;
    }

    if (has('active')) {
        if (![true, false, 0, 1, '0', '1', 'true', 'false'].includes(input.active)) fail("'active' deve ser verdadeiro ou falso.");
        out.active = [true, 1, '1', 'true'].includes(input.active);
    }

    if (!creating && !Object.keys(out).length) fail('Nada para alterar.');
    return out;
}

/**
 * @param {object} input
 * @param {string|null} input.current      - REP cadastrado hoje.
 * @param {string|null} input.next         - REP pedido.
 * @param {boolean}     input.hasRecords   - o relógio já tem linhas no espelho?
 */
function assertRepNumberChange({ current, next, hasRecords }) {
    if (current && next !== current && hasRecords) {
        fail(
            `Este cadastro já tem registros do REP ${current}. Outro equipamento é outro cadastro — crie um relógio novo em vez de trocar o REP.`,
            409,
        );
    }
}

/**
 * `CPPP_DEVICE_ALLOWED_NETWORKS=192.168.10.0/24,10.0.0.0/8` → lista; vazio = padrão.
 * @param {string|undefined} value
 * @returns {string[]}
 */
function parseAllowedNetworks(value) {
    const list = String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
    return list.length ? list : [...DEFAULT_ALLOWED_NETWORKS];
}

module.exports = {
    DEFAULT_ALLOWED_NETWORKS,
    ipInCidr,
    normalizeBaseUrl,
    normalizeDevice,
    assertRepNumberChange,
    parseAllowedNetworks,
};
