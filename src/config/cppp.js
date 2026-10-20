/**
 * @fileoverview Configuração da suite CPPP (ponto Control iD) lida do ambiente.
 *
 * Centralizada para que nenhum caso de uso leia `process.env` direto — é o que
 * permite injetar outra configuração no teste.
 *
 * ─── Credenciais ──────────────────────────────────────────────────────────────
 * Um login e uma senha servem para TODOS os relógios (decisão de 08/10/2026):
 * `CPPP_DEVICE_LOGIN` (padrão `admin`) e `CPPP_DEVICE_PASSWORD`. Nada disso vai
 * para o banco. O cadastro do relógio (`cppp_devices`) — nome e IP — é feito
 * pela tela, então relógio novo não exige mexer no servidor.
 *
 * @module config/cppp
 */

require('dotenv').config();
const path = require('path');
const { parseAllowedNetworks } = require('../modules/global/domain/cppp/device/device.rules');

/** @param {string} name @param {number} fallback @returns {number} */
function numberFromEnv(name, fallback) {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Só `false`/`0`/`no` desligam — erro de digitação mantém a verificação. */
function flagFromEnv(name, fallback) {
    const value = String(process.env[name] ?? '').trim().toLowerCase();
    if (['false', '0', 'no', 'nao', 'não', 'off'].includes(value)) return false;
    if (['true', '1', 'yes', 'sim', 'on'].includes(value)) return true;
    return fallback;
}

const cpppConfig = {
    // Verificação do certificado TLS do relógio. O REP-C usa certificado
    // AUTOASSINADO, então em produção precisa estar `false` — mas o padrão é
    // `true`: esquecer a variável faz a coleta falhar com uma mensagem clara,
    // em vez de desligar a verificação de qualquer HTTPS sem ninguém decidir.
    verifyTls: flagFromEnv('CPPP_VERIFY_TLS', true),

    // O AFD integral é lento para o equipamento gerar (~44 mil linhas hoje).
    timeoutMs: numberFromEnv('CPPP_TIMEOUT_SECONDS', 180) * 1000,

    // Teste de conexão da tela (login + logout): curto, porque há uma pessoa
    // esperando a resposta. O AFD é que é lento, não o login.
    testTimeoutMs: numberFromEnv('CPPP_TEST_TIMEOUT_SECONDS', 15) * 1000,

    afdMode: numberFromEnv('CPPP_AFD_MODE', 671),

    // Onde o AFD bruto de cada coleta é gravado, byte a byte. O padrão cai em
    // `./storage`, que no compose é bind mount do host — sobrevive a rebuild.
    storageRoot: process.env.CPPP_STORAGE_ROOT?.trim()
        ? path.resolve(process.env.CPPP_STORAGE_ROOT.trim())
        : path.resolve(__dirname, '..', '..', 'storage', 'cppp'),

    // Coleta automática: uma vez por dia, neste horário (fuso do container,
    // America/Sao_Paulo), trazendo o dia anterior inteiro.
    collectTime: (process.env.CPPP_COLLECT_TIME || '02:00').trim(),

    // De quanto em quanto tempo o worker olha a fila (coleta disparada pela
    // tela). Não é a cadência da coleta — essa é diária.
    queuePollMs: numberFromEnv('CPPP_QUEUE_POLL_SECONDS', 15) * 1000,

    // Coleta `running` há mais que isto é de um worker que morreu no meio.
    // Precisa ser bem maior que o timeout do relógio.
    stuckRunMinutes: numberFromEnv('CPPP_STUCK_RUN_MINUTES', 30),

    // ─── Regras de detecção (valores do ETL) ─────────────────────────────────
    rules: {
        duplicateWindowMinutes: numberFromEnv('CPPP_DUPLICATE_WINDOW_MINUTES', 3),
        earlyCloseMinutes: numberFromEnv('CPPP_EARLY_CLOSE_MINUTES', 90),
        minBaselineDays: numberFromEnv('CPPP_MIN_BASELINE_DAYS', 5),
    },

    // Histórico lido para a mediana do `fecha_cedo`, independente do período
    // filtrado na tela.
    baselineDays: numberFromEnv('CPPP_BASELINE_DAYS', 60),

    // Teto do período de uma consulta e do período de um ajuste (férias).
    maxPeriodDays: numberFromEnv('CPPP_MAX_PERIOD_DAYS', 92),

    // Redes em que um relógio pode ser cadastrado (CIDR, separadas por
    // vírgula). O servidor manda a senha compartilhada para o IP cadastrado —
    // ver `domain/cppp/device/device.rules.js`. Padrão: faixas privadas.
    allowedNetworks: parseAllowedNetworks(process.env.CPPP_DEVICE_ALLOWED_NETWORKS),
};

/**
 * Credenciais de acesso aos relógios — as mesmas para todos.
 *
 * Função, e não constante, para o teste poder injetar outra. Senha trocada no
 * `.env` do servidor vale ao recriar o container (`docker compose up -d`) —
 * não precisa de rebuild, mas `docker compose restart` NÃO relê o `env_file`.
 *
 * @returns {{login: string, password: string}}
 */
function deviceCredentials() {
    return {
        login: process.env.CPPP_DEVICE_LOGIN || 'admin',
        password: process.env.CPPP_DEVICE_PASSWORD || '',
    };
}

module.exports = { cpppConfig, deviceCredentials };
