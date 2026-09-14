/**
 * @fileoverview Configuração da suite meipp lida do ambiente.
 *
 * Centralizada para que nenhum caso de uso leia `process.env` direto — é o que
 * permite injetar outra configuração no teste sem mexer no ambiente do
 * processo.
 *
 * @module config/meipp
 */

require('dotenv').config();

/**
 * @typedef {object} MeippConfig
 * @property {string}      mediaTokenSecret   - HMAC das URLs de mídia.
 * @property {string}      pairingSecret      - HMAC dos códigos de pareamento.
 * @property {string}      publicBaseUrl      - prefixo das URLs entregues ao player.
 * @property {number}      mediaTokenTtlHours
 * @property {number}      pairingTtlMinutes
 * @property {number|null} deviceTokenTtlDays - `null` = token sem expiração.
 * @property {number|null} fallbackPlaylistId - playlist padrão quando nada casa.
 */

/** @param {string} name @param {number} fallback @returns {number} */
function numberFromEnv(name, fallback) {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** @param {string} name @returns {number|null} */
function optionalNumberFromEnv(name) {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** @type {MeippConfig} */
const meippConfig = {
    mediaTokenSecret: process.env.MEIPP_MEDIA_TOKEN_SECRET || '',
    pairingSecret: process.env.MEIPP_PAIRING_SECRET || '',

    // As URLs de mídia entregues ao player precisam ser absolutas: o Android
    // não tem "origem" para resolver caminho relativo. Em produção é
    // `https://vagas.gpprh.com.br/api/v1/global`.
    publicBaseUrl: process.env.MEIPP_PUBLIC_BASE_URL || '',

    mediaTokenTtlHours: numberFromEnv('MEIPP_MEDIA_TOKEN_TTL_HOURS', 24),
    pairingTtlMinutes: numberFromEnv('MEIPP_PAIRING_TTL_MINUTES', 10),

    // Ausente = token de device sem expiração, revogável só manualmente. É o
    // comportamento pedido no requisito ("reutilizado indefinidamente até ser
    // revogado"); definir a variável liga a rotação por tempo.
    deviceTokenTtlDays: optionalNumberFromEnv('MEIPP_DEVICE_TOKEN_TTL_DAYS'),

    // Passo 7 do resolvedor: playlist tocada quando nenhum agendamento casa.
    // Ausente = o player mantém o último conteúdo em cache.
    fallbackPlaylistId: optionalNumberFromEnv('MEIPP_FALLBACK_PLAYLIST_ID'),

    // Sem heartbeat por este tempo, a tela é considerada offline na leitura
    // (ver `PLAYER_STATUS_EXPRESSION`). Precisa ser folgado em relação à
    // cadência do heartbeat do app — com heartbeat de 1 min, 5 min tolera
    // quatro perdas seguidas antes de acusar queda.
    offlineAfterMinutes: numberFromEnv('MEIPP_OFFLINE_AFTER_MINUTES', 5),
};

/**
 * Valida o que é obrigatório para o módulo funcionar.
 *
 * Chamada na montagem das rotas, não na importação: o mesmo processo sobe
 * outros módulos, e um `.env` sem as chaves do meipp não pode impedir o EPP ou
 * o GTPP de subir.
 *
 * @returns {string[]} nomes das variáveis faltando.
 */
function missingMeippEnv() {
    const missing = [];
    if (!meippConfig.mediaTokenSecret) missing.push('MEIPP_MEDIA_TOKEN_SECRET');
    if (!meippConfig.pairingSecret) missing.push('MEIPP_PAIRING_SECRET');
    return missing;
}

module.exports = { meippConfig, missingMeippEnv };
