/**
 * @fileoverview Normalização e crítica do lote de exibições reportado pelo
 * player (proof-of-play).
 *
 * Puro: não conhece banco, HTTP nem relógio do servidor a não ser pelo `now`
 * injetado. Mora no domínio porque a decisão "este evento presta ou não" é
 * regra de produto, e é a mesma decisão independentemente de o lote chegar por
 * `POST /miepp/device/plays` hoje ou por outro caminho amanhã.
 *
 * ─── Por que a crítica é por EVENTO e não pelo lote ──────────────────────────
 *
 * O `validate.middleware` da casa só conhece string, number e boolean — array
 * de objeto não se expressa lá (mesma razão de `items` da grade de produtos ser
 * validado no caso de uso). Mas a razão principal é outra, e é de produto:
 *
 * Recusar o lote inteiro por causa de um evento ruim TRAVA A FILA DO PLAYER.
 * A tela guarda as exibições localmente enquanto está sem rede; se o servidor
 * responde 400 para o lote, o app reenvia o mesmo lote para sempre, o evento
 * ruim nunca sai da fila e a tela nunca mais reporta nada. Por isso cada evento
 * é aceito ou recusado individualmente, com MOTIVO — e o contrato com o app é:
 * tudo que voltou nomeado na resposta (aceito, duplicado ou recusado) pode ser
 * descartado da fila local.
 *
 * @module modules/global/domain/miepp/play/play-event.rules
 */

/**
 * Eventos por requisição.
 *
 * Uma tela 12h no ar com carrossel de ~15s enfileira ~2.900 exibições por dia
 * offline, então o lote existe para ela drenar em algumas requisições — não em
 * 2.900. O teto é 200 porque o ingest grava evento por evento dentro de UMA
 * transação (ver o adapter): 200 eventos são ~400 idas ao banco, que cabem
 * folgadas no timeout de 15s do pool; 2.000 não cabem, e uma transação que
 * estoura o timeout no meio segura conexão do pool que as estações também usam.
 */
const MAX_PLAYS_PER_BATCH = 200;

/**
 * Teto do tempo em tela de UMA exibição: 24h, o mesmo teto de
 * `duration_seconds` da mídia. Acima disso não é exibição longa, é contador do
 * app que não foi zerado — e somar isso ao acumulado estragaria o total do dia
 * inteiro.
 */
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Tolerância para o relógio do dispositivo estar adiantado.
 *
 * O carimbo é o do PLAYER (é ele que sabe quando a mídia apareceu na parede), e
 * relógio de caixa Android erra. 1h absorve fuso mal configurado e deriva
 * comum; além disso é relógio quebrado, e aceitar produziria exibição
 * "acontecendo amanhã" no relatório.
 */
const FUTURE_TOLERANCE_MS = 60 * 60 * 1000;

/**
 * Idade máxima aceita. Passou disso, o relógio do dispositivo está errado por
 * anos (Android sem rede volta para a data de fábrica), não é fila atrasada.
 * Folgado de propósito em relação aos 90 dias de retenção do evento cru: fila
 * velha ainda soma no acumulado, que é a memória longa.
 */
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

/** Formato aceito para a chave de idempotência gerada no dispositivo. */
const EVENT_UUID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,63}$/;

/** UUID de mídia, como o player o recebe em `GET /device/playlist`. */
const MEDIA_UUID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Motivos de recusa. São devolvidos ao dispositivo como código estável — o app
 * pode decidir o que logar sem depender do texto em português.
 */
const RejectReason = Object.freeze({
    INVALID_EVENT_UUID:   'invalid_event_uuid',
    INVALID_MEDIA_UUID:   'invalid_media_uuid',
    INVALID_STARTED_AT:   'invalid_started_at',
    STARTED_AT_IN_FUTURE: 'started_at_in_future',
    STARTED_AT_TOO_OLD:   'started_at_too_old',
    INVALID_DURATION:     'invalid_duration',
    DUPLICATE_IN_BATCH:   'duplicate_in_batch',
    /** Decidido no caso de uso, não aqui: depende do banco. */
    UNKNOWN_MEDIA:        'unknown_media',
});

/**
 * `YYYY-MM-DD HH:MM:SS` nos componentes LOCAIS da data.
 *
 * O pool não define `timezone` nem `dateStrings`, então entregar um `Date` ao
 * driver deixaria a conversão por conta do fuso do processo — e este banco já
 * pagou por isso (ver `converte-historico-para-hora-local.sql` e o
 * `fix-historico-hora-local-definitivo.sql`). Formatando explicitamente, o que
 * vai para a coluna é hora local, igual ao resto do schema, e
 * `DATE(started_at)` do acumulado bate com o dia de calendário da loja.
 *
 * @param {Date} date
 * @returns {string}
 */
function toMysqlDateTime(date) {
    const pad = (part) => String(part).padStart(2, '0');
    return (
        String(date.getFullYear()).padStart(4, '0')
        + '-' + pad(date.getMonth() + 1)
        + '-' + pad(date.getDate())
        + ' ' + pad(date.getHours())
        + ':' + pad(date.getMinutes())
        + ':' + pad(date.getSeconds())
    );
}

/**
 * `YYYY-MM-DD` local — a chave de dia do acumulado.
 *
 * Derivada do mesmo `Date` que gera o `started_at`, e não por `DATE()` no SQL,
 * para que evento cru e acumulado não possam discordar de dia na virada da
 * meia-noite.
 *
 * @param {Date} date
 * @returns {string}
 */
function toMysqlDate(date) {
    return toMysqlDateTime(date).slice(0, 10);
}

/** @private Inteiro não negativo, ou `null` quando o valor não serve. */
function optionalId(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Identificador do evento apenas para NOMEAR a recusa na resposta.
 *
 * Um evento cujo `event_uuid` é inválido ainda precisa aparecer na resposta de
 * alguma forma, senão o app não sabe o que descartar.
 *
 * @private
 * @param {*} raw
 * @returns {string|null}
 */
function labelOf(raw) {
    const value = raw && typeof raw === 'object' ? raw.event_uuid : null;
    return typeof value === 'string' && value.length > 0 ? value.slice(0, 64) : null;
}

/**
 * Normaliza UM evento. Devolve o evento pronto para o repositório ou o motivo
 * da recusa — nunca os dois.
 *
 * `completed` é coerção tolerante de propósito: versões diferentes do APK
 * mandam `true`, `1` ou `"true"`, e nenhuma dessas variações justifica perder a
 * exibição. Ausente conta como `false` (cortada), que é o mais conservador: não
 * inflar `completed_plays` é melhor do que inflar.
 *
 * @param {*}    raw
 * @param {Date} now
 * @returns {{play: object}|{reason: string}}
 */
function normalizePlay(raw, now) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return { reason: RejectReason.INVALID_EVENT_UUID };
    }

    const eventUuid = typeof raw.event_uuid === 'string' ? raw.event_uuid.trim() : '';
    if (!EVENT_UUID_PATTERN.test(eventUuid)) {
        return { reason: RejectReason.INVALID_EVENT_UUID };
    }

    const mediaUuid = typeof raw.media_uuid === 'string' ? raw.media_uuid.trim() : '';
    if (!MEDIA_UUID_PATTERN.test(mediaUuid)) {
        return { reason: RejectReason.INVALID_MEDIA_UUID };
    }

    if (typeof raw.started_at !== 'string' && !(raw.started_at instanceof Date)) {
        return { reason: RejectReason.INVALID_STARTED_AT };
    }
    const startedAt = raw.started_at instanceof Date ? raw.started_at : new Date(raw.started_at);
    if (Number.isNaN(startedAt.getTime())) {
        return { reason: RejectReason.INVALID_STARTED_AT };
    }

    const drift = startedAt.getTime() - now.getTime();
    if (drift > FUTURE_TOLERANCE_MS) return { reason: RejectReason.STARTED_AT_IN_FUTURE };
    if (-drift > MAX_AGE_MS) return { reason: RejectReason.STARTED_AT_TOO_OLD };

    const duration = Number(raw.duration_ms);
    if (!Number.isFinite(duration) || duration < 0 || duration > MAX_DURATION_MS) {
        return { reason: RejectReason.INVALID_DURATION };
    }

    return {
        play: {
            event_uuid:  eventUuid,
            media_uuid:  mediaUuid,
            started_at:  toMysqlDateTime(startedAt),
            play_date:   toMysqlDate(startedAt),
            duration_ms: Math.trunc(duration),
            completed:   raw.completed === true || raw.completed === 1 || raw.completed === 'true' ? 1 : 0,
            // O player recebe os dois em `GET /device/playlist`. São snapshot:
            // dizem sob qual programação a mídia apareceu, e por isso não são
            // recalculados na leitura do relatório.
            playlist_id: optionalId(raw.playlist_id),
            schedule_id: optionalId(raw.schedule_id),
        },
    };
}

/**
 * Crítica do lote inteiro.
 *
 * A deduplicação DENTRO do lote não é redundante com a UNIQUE do banco: sem
 * ela, dois eventos com o mesmo `event_uuid` no mesmo corpo fariam o segundo
 * INSERT falhar por chave duplicada no meio da transação — e o ingest é
 * transacional, então o lote todo voltaria. Filtrar aqui é o que mantém a
 * promessa de que um evento ruim não derruba os bons.
 *
 * @param {*}    rawPlays
 * @param {Date} [now]
 * @returns {{plays: object[], rejected: Array<{event_uuid: string|null, reason: string}>}}
 */
function normalizeBatch(rawPlays, now = new Date()) {
    const plays = [];
    const rejected = [];
    const seen = new Set();

    for (const raw of rawPlays) {
        const result = normalizePlay(raw, now);

        if (result.reason) {
            rejected.push({ event_uuid: labelOf(raw), reason: result.reason });
            continue;
        }

        if (seen.has(result.play.event_uuid)) {
            rejected.push({
                event_uuid: result.play.event_uuid,
                reason: RejectReason.DUPLICATE_IN_BATCH,
            });
            continue;
        }

        seen.add(result.play.event_uuid);
        plays.push(result.play);
    }

    return { plays, rejected };
}

/**
 * Erro que invalida a REQUISIÇÃO toda (não um evento), ou `null`.
 *
 * São só os dois casos em que não há lote nenhum para processar: corpo sem
 * lista e lista acima do teto. Tudo mais é recusa por evento.
 *
 * @param {*} rawPlays
 * @returns {string|null}
 */
function findBatchError(rawPlays) {
    if (!Array.isArray(rawPlays)) {
        return 'O campo "plays" é obrigatório e precisa ser uma lista de exibições.';
    }
    if (rawPlays.length === 0) {
        return 'Envie ao menos uma exibição em "plays".';
    }
    if (rawPlays.length > MAX_PLAYS_PER_BATCH) {
        return `Envie no máximo ${MAX_PLAYS_PER_BATCH} exibições por requisição `
            + `(recebidas ${rawPlays.length}). Divida a fila em lotes.`;
    }
    return null;
}

module.exports = {
    MAX_PLAYS_PER_BATCH,
    MAX_DURATION_MS,
    FUTURE_TOLERANCE_MS,
    MAX_AGE_MS,
    EVENT_UUID_PATTERN,
    MEDIA_UUID_PATTERN,
    RejectReason,
    toMysqlDateTime,
    toMysqlDate,
    normalizePlay,
    normalizeBatch,
    findBatchError,
};
