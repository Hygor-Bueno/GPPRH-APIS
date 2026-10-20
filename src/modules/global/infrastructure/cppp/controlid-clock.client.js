/**
 * @fileoverview Cliente HTTP do relógio Control iD (REP-C).
 *
 * Porte do `controlid_etl/client.py`. Só as três rotas VERIFICADAS contra o
 * equipamento em produção:
 *
 *   POST /login.fcgi                               → {"session": "..."}
 *   POST /get_afd.fcgi?session=<s>&mode=671        → texto puro (o AFD)
 *   POST /logout.fcgi?session=<s>                  → best-effort
 *
 * Todas POST, corpo JSON, sessão na QUERY STRING (não em header).
 *
 * ⚠️ NÃO acrescente rota de escrita aqui. A API do equipamento tem CRUD de
 *    cadastro, mas os nomes variam por firmware e não foram confirmados neste
 *    relógio — e marcação não se altera nem se insere num REP-C, por lei e
 *    por construção. Não descubra endpoint por tentativa e erro contra
 *    equipamento fiscal em produção.
 *
 * @module modules/global/infrastructure/cppp/controlid-clock.client
 */

const https = require('https');
const axios = require('axios');

const { CpppClockClientPort } = require('../../application/cppp/ports/cppp-external.ports');
const { AppError } = require('../../../../errors/app.error');
const { deviceCredentials } = require('../../../../config/cppp');

/** Teto do corpo do AFD. Hoje ~3 MB para 6 meses; 200 MB é folga de anos. */
const MAX_AFD_BYTES = 200 * 1024 * 1024;

const TLS_ERRORS = new Set([
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'CERT_HAS_EXPIRED',
]);

/** Nome do relógio nas mensagens; no teste de um IP ainda não salvo, o próprio IP. */
const label = (device) => device.code || device.base_url;

class ControlIdClockClient extends CpppClockClientPort {
    /**
     * @param {object} deps
     * @param {{verifyTls: boolean, timeoutMs: number, afdMode: number}} deps.config
     * @param {(code: string) => {login: string, password: string}} [deps.credentials]
     * @param {object} [deps.http] - axios (injetável no teste).
     */
    constructor({ config, credentials = deviceCredentials, http = axios }) {
        super();
        this.config = config;
        this.credentials = credentials;
        this.http = http;
    }

    /**
     * ─── Sessão: abre e fecha a cada chamada ─────────────────────────────────
     * O login do relógio expira, então nenhuma sessão é guardada entre
     * chamadas: cada `fetchAfd`/`testConnection` faz login → operação →
     * logout, com um `https.Agent` próprio sem keep-alive (nenhum socket
     * sobrevive à chamada). O logout fica no `finally`, então roda também
     * quando o download falha.
     */
    async fetchAfd(device, { initialNsr = null } = {}) {
        return this._withSession(device, this.config.timeoutMs, async (agent, session) => {
            const body = initialNsr === null || initialNsr === undefined ? {} : { initial_nsr: Number(initialNsr) };
            const response = await this._post(device, agent, '/get_afd.fcgi', body, {
                params: { session, mode: this.config.afdMode },
                responseType: 'arraybuffer',
                timeout: this.config.timeoutMs,
            });
            // O corpo vai intocado para o disco — nada de `toString()` aqui.
            return Buffer.from(response.data);
        });
    }

    /**
     * Teste de conexão da tela de cadastro: só login + logout, as duas rotas
     * verificadas. Confirma rede, TLS e credencial sem baixar o AFD.
     *
     * @returns {Promise<{ok: true, elapsedMs: number}>}
     */
    async testConnection(device) {
        const started = Date.now();
        await this._withSession(device, this.config.testTimeoutMs, async () => {});
        return { ok: true, elapsedMs: Date.now() - started };
    }

    async _withSession(device, timeout, run) {
        const { login, password } = this.credentials();
        if (!password) {
            throw new AppError(
                'Senha dos relógios não configurada (CPPP_DEVICE_PASSWORD no .env do servidor).',
                500,
                { code: 'CPPP_DEVICE_NOT_CONFIGURED' },
            );
        }

        // Um agent por chamada: a verificação de TLS desligada fica restrita a
        // ESTAS requisições, nunca vira padrão do processo.
        const agent = new https.Agent({ rejectUnauthorized: this.config.verifyTls, keepAlive: false });

        const session = await this._login(device, agent, login, password, timeout);
        try {
            return await run(agent, session);
        } finally {
            await this._logout(device, agent, session, timeout);
            agent.destroy();
        }
    }

    async _login(device, agent, login, password, timeout) {
        const response = await this._post(device, agent, '/login.fcgi', { login, password }, { timeout });
        let data = response.data;
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch { data = null; }
        }
        if (!data?.session) {
            throw new AppError(`O relógio ${label(device)} não devolveu sessão no login.`, 502, { code: 'CPPP_DEVICE_LOGIN' });
        }
        return String(data.session);
    }

    /**
     * Falha de logout é engolida, como no ETL — o sucesso desta rota nunca foi
     * confirmado no equipamento, e a sessão expira sozinha.
     */
    async _logout(device, agent, session, timeout) {
        try {
            await this._post(device, agent, '/logout.fcgi', {}, { params: { session }, timeout });
        } catch {
            /* best-effort */
        }
    }

    async _post(device, agent, path, body, { params, responseType, timeout = this.config.timeoutMs } = {}) {
        const url = `${String(device.base_url).replace(/\/+$/, '')}${path}`;
        let response;
        try {
            response = await this.http.post(url, body, {
                params,
                httpsAgent: agent,
                timeout,
                responseType,
                headers: { 'Content-Type': 'application/json' },
                maxContentLength: MAX_AFD_BYTES,
                maxBodyLength: MAX_AFD_BYTES,
                validateStatus: () => true,
                // Sem proxy de ambiente: o relógio está na rede interna, e um
                // HTTP(S)_PROXY herdado mandaria a senha para fora.
                proxy: false,
                // O servidor web embutido do REP-C termina as linhas do
                // cabeçalho HTTP só com LF, sem CR. O parser estrito do Node
                // recusa com `HPE_CR_EXPECTED` (visto em 08/10/2026, de dentro
                // do container); o `requests` do ETL Python aceitava calado.
                // Leniência restrita a ESTAS requisições, ao relógio —
                // nunca ligar `--insecure-http-parser` no processo.
                insecureHTTPParser: true,
            });
        } catch (error) {
            const code = error.code || error.cause?.code;
            const hint = TLS_ERRORS.has(code)
                ? ' — o certificado do relógio é autoassinado; em produção use CPPP_VERIFY_TLS=false.'
                : '';
            throw new AppError(
                `Falha de comunicação com o relógio ${label(device)} (${code || error.message})${hint}`,
                502,
                { code: 'CPPP_DEVICE_UNREACHABLE', details: { path, code } },
            );
        }

        if (response.status < 200 || response.status >= 300) {
            const preview = Buffer.isBuffer(response.data) || response.data instanceof ArrayBuffer
                ? Buffer.from(response.data).toString('utf8', 0, 300)
                : String(typeof response.data === 'object' ? JSON.stringify(response.data) : response.data ?? '').slice(0, 300);
            throw new AppError(
                `Relógio ${label(device)} respondeu HTTP ${response.status} em ${path}: ${preview.replace(/\s+/g, ' ')}`,
                502,
                { code: 'CPPP_DEVICE_HTTP' },
            );
        }

        return response;
    }
}

module.exports = { ControlIdClockClient };
