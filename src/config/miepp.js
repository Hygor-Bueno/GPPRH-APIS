/**
 * @fileoverview Configuração da suite miepp lida do ambiente.
 *
 * Centralizada para que nenhum caso de uso leia `process.env` direto — é o que
 * permite injetar outra configuração no teste sem mexer no ambiente do
 * processo.
 *
 * @module config/miepp
 */

require('dotenv').config();

/**
 * @typedef {object} MieppConfig
 * @property {string}      mediaTokenSecret   - HMAC das URLs de mídia.
 * @property {string}      publicBaseUrl      - prefixo das URLs entregues ao player.
 * @property {number}      mediaTokenTtlHours
 * @property {number}      pairingCodeLength  - dígitos do código de pareamento.
 * @property {number}      pairingTtlMinutes
 * @property {number|null} deviceTokenTtlDays - `null` = token sem expiração.
 * @property {number|null} fallbackPlaylistId - playlist padrão quando nada casa.
 * @property {number|null} fallbackMediaId    - mídia de reserva quando o conteúdo vence.
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

/** @type {MieppConfig} */
const mieppConfig = {
    mediaTokenSecret: process.env.MIEPP_MEDIA_TOKEN_SECRET || '',

    // As URLs de mídia entregues ao player precisam ser absolutas: o Android
    // não tem "origem" para resolver caminho relativo. Em produção é
    // `https://vagas.gpprh.com.br/api/v1/global`.
    publicBaseUrl: process.env.MIEPP_PUBLIC_BASE_URL || '',

    mediaTokenTtlHours: numberFromEnv('MIEPP_MEDIA_TOKEN_TTL_HOURS', 24),
    pairingTtlMinutes: numberFromEnv('MIEPP_PAIRING_TTL_MINUTES', 10),

    // Dígitos do código de pareamento. 8 é o teto do requisito: precisa caber
    // num controle remoto. Encurtar mais derruba a entropia a um ponto em que
    // o `pairLimiter` vira a única defesa — ver o cabeçalho do serviço.
    pairingCodeLength: numberFromEnv('MIEPP_PAIRING_CODE_LENGTH', 8),

    // Ausente = token de device sem expiração, revogável só manualmente. É o
    // comportamento pedido no requisito ("reutilizado indefinidamente até ser
    // revogado"); definir a variável liga a rotação por tempo.
    deviceTokenTtlDays: optionalNumberFromEnv('MIEPP_DEVICE_TOKEN_TTL_DAYS'),

    // Passo 7 do resolvedor: playlist tocada quando nenhum agendamento casa.
    // Ausente = o player mantém o último conteúdo em cache.
    fallbackPlaylistId: optionalNumberFromEnv('MIEPP_FALLBACK_PLAYLIST_ID'),

    // Mídia de RESERVA — não é a mesma coisa que a playlist de fallback acima.
    // Os gatilhos são diferentes:
    //
    //   fallbackPlaylistId → "nenhum agendamento casou"      (não há o que tocar)
    //   fallbackMediaId    → "o que havia para tocar venceu" (há, mas não vale)
    //
    // É o conteúdo perene e SEM PREÇO que entra quando a grade vence: na tela
    // offline por decisão do app, na tela online por decisão daqui (ver
    // `shapeItems`). Sem esta variável o servidor não consegue derrubar uma
    // grade vencida sem apagar a parede, e a grade fica no ar com preço velho.
    //
    // Precisa apontar para mídia `ready` que NÃO seja grade — o caso de uso
    // recusa as duas coisas e responde como se não houvesse reserva.
    fallbackMediaId: optionalNumberFromEnv('MIEPP_FALLBACK_MEDIA_ID'),

    // Sem heartbeat por este tempo, a tela é considerada offline na leitura
    // (ver `PLAYER_STATUS_EXPRESSION`). Precisa ser folgado em relação à
    // cadência do heartbeat do app — com heartbeat de 1 min, 5 min tolera
    // quatro perdas seguidas antes de acusar queda.
    offlineAfterMinutes: numberFromEnv('MIEPP_OFFLINE_AFTER_MINUTES', 5),

    // ─── Renderizador da grade de produtos ───────────────────────────────────
    //
    // ⚠️ O intervalo NÃO é o atraso que o cliente vê na parede. O atraso real é
    //    `intervalo do render + intervalo de poll do player + resto da volta do
    //    carrossel`. Encurtar só este número, sem encurtar o poll do app, gasta
    //    Oracle sem adiantar nada na loja.
    //
    // 5 min é o padrão porque a grade mostra PREÇO. Para grade sem preço, 30
    // min seria folgado — descrição muda raro.
    gridRenderIntervalMs: numberFromEnv('MIEPP_GRID_RENDER_INTERVAL_MS', 5 * 60 * 1000),

    // Grades visitadas por ciclo. O Chromium abre uma vez para o lote inteiro,
    // então cada grade a mais custa só o screenshot.
    gridRenderBatch: numberFromEnv('MIEPP_GRID_RENDER_BATCH', 20),

    // Resolução da imagem gerada. Mudar aqui troca o binário de TODAS as grades
    // no próximo ciclo: a resolução não entra no `data_hash` (não é conteúdo, é
    // meio), então o hash não muda, mas o arquivo sim — e as telas rebaixam.
    gridRenderWidth: numberFromEnv('MIEPP_GRID_RENDER_WIDTH', 1920),
    gridRenderHeight: numberFromEnv('MIEPP_GRID_RENDER_HEIGHT', 1080),
};

/**
 * Valida o que é obrigatório para o módulo funcionar.
 *
 * Chamada na montagem das rotas, não na importação: o mesmo processo sobe
 * outros módulos, e um `.env` sem as chaves do miepp não pode impedir o EPP ou
 * o GTPP de subir.
 *
 * @returns {string[]} nomes das variáveis faltando.
 */
function missingMieppEnv() {
    const missing = [];
    if (!mieppConfig.mediaTokenSecret) missing.push('MIEPP_MEDIA_TOKEN_SECRET');
    return missing;
}

module.exports = { mieppConfig, missingMieppEnv };
