/**
 * @fileoverview Monta as linhas dos relatórios de exibição como a API as
 * entrega.
 *
 * Puro. Existe por uma razão concreta, não por simetria: `SUM()` sobre
 * `BIGINT UNSIGNED` volta do mysql2 como STRING, e `COUNT(DISTINCT ...)` volta
 * como number. Sem normalizar na borda, a mesma resposta traria
 * `"plays": 12` e `"duration_ms": "480000"`, e o consumidor teria de adivinhar
 * quais campos precisam de `Number()`.
 *
 * O tempo em tela sai em SEGUNDOS na resposta, não em milissegundos: a coluna
 * guarda ms porque o player mede em ms, mas ninguém lê relatório de audiência
 * em milissegundo.
 *
 * @module modules/global/domain/miepp/play/play-report.shaper
 */

/** @private Inteiro a partir de number, string decimal do driver ou null. */
function toInt(value) {
    if (value === null || value === undefined) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

/**
 * `location_id = 0` é o sentinela de "sem local" do acumulado (ver o DDL: NULL
 * não agrupa em chave única). A API nunca o expõe.
 *
 * @param {*} value
 * @returns {number|null}
 */
function toLocationId(value) {
    const parsed = toInt(value);
    return parsed > 0 ? parsed : null;
}

/**
 * Os números que toda linha de relatório carrega.
 *
 * `seconds_on_screen` é o tempo somado de verdade, não `plays × duração
 * programada` — a diferença entre os dois é justamente o que o proof-of-play
 * existe para revelar (tela rebootando no meio da mídia, playlist trocando
 * antes do fim).
 *
 * @private
 * @param {object} row
 * @returns {object}
 */
function shapeCounters(row) {
    const plays = toInt(row.plays);
    const completed = toInt(row.completed_plays);

    return {
        plays,
        completed_plays: completed,
        // Quantas terminaram, em proporção. `null` com zero exibição, porque 0%
        // e "não houve exibição" são coisas diferentes no relatório.
        completion_rate: plays > 0 ? Math.round((completed / plays) * 1000) / 1000 : null,
        seconds_on_screen: Math.round(toInt(row.duration_ms) / 1000),
    };
}

/**
 * Linha do ranking: uma mídia no período.
 *
 * `title` prefere o título ATUAL da mídia (join com `miepp_media`) e cai no
 * snapshot gravado no ingest quando a mídia já foi apagada — `DELETE` de mídia
 * é físico, e um relatório com a linha em branco não serviria de nada.
 * `media_exists` diz qual dos dois veio, para o painel poder marcar a linha
 * como histórica em vez de oferecer um link que dá 404.
 *
 * @param {object} row
 * @returns {object}
 */
function shapeMediaRow(row) {
    return {
        media_id: toInt(row.media_id),
        media_uuid: row.media_uuid ?? null,
        title: row.current_title ?? row.media_title ?? null,
        type: row.type ?? null,
        media_exists: Boolean(row.media_uuid),
        ...shapeCounters(row),
        players: toInt(row.players),
        locations: toInt(row.locations),
        first_play_at: row.first_play_at ?? null,
        last_play_at: row.last_play_at ?? null,
    };
}

/**
 * Linha do recorte por LOCAL — "em quais locais essa mídia passou".
 *
 * @param {object} row
 * @returns {object}
 */
function shapeLocationRow(row) {
    return {
        location_id: toLocationId(row.location_id),
        location_name: row.location_name ?? null,
        ...shapeCounters(row),
        players: toInt(row.players),
        first_play_at: row.first_play_at ?? null,
        last_play_at: row.last_play_at ?? null,
    };
}

/**
 * Linha do recorte por TELA — "em quais dispositivos essa mídia passou".
 *
 * O local vem do ACUMULADO, não do cadastro atual do player: é onde a tela
 * estava quando exibiu. Uma tela que mudou de loja no período aparece em duas
 * linhas, uma por local, e isso é o comportamento correto.
 *
 * @param {object} row
 * @returns {object}
 */
function shapePlayerRow(row) {
    return {
        player_id: toInt(row.player_id),
        player_name: row.player_name ?? null,
        location_id: toLocationId(row.location_id),
        location_name: row.location_name ?? null,
        ...shapeCounters(row),
        first_play_at: row.first_play_at ?? null,
        last_play_at: row.last_play_at ?? null,
    };
}

/**
 * Linha do recorte por DIA.
 *
 * `play_date` sai como `YYYY-MM-DD`: a coluna é DATE e o driver a entrega como
 * `Date` à meia-noite local, que serializaria em JSON como instante UTC —
 * `2026-09-21` viraria `2026-09-20T03:00:00.000Z` no fuso daqui, um dia antes
 * do que o relatório diz.
 *
 * @param {object} row
 * @returns {object}
 */
function shapeDayRow(row) {
    return {
        play_date: toDateKey(row.play_date),
        ...shapeCounters(row),
        players: toInt(row.players),
    };
}

/**
 * Normaliza a coluna DATE para `YYYY-MM-DD`.
 *
 * @param {Date|string|null} value
 * @returns {string|null}
 */
function toDateKey(value) {
    if (value === null || value === undefined) return null;

    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        const pad = (part) => String(part).padStart(2, '0');
        return String(value.getFullYear()).padStart(4, '0')
            + '-' + pad(value.getMonth() + 1)
            + '-' + pad(value.getDate());
    }

    const text = String(value).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

/**
 * Totais do período, no mesmo formato dos contadores das linhas.
 *
 * @param {object|null} row
 * @returns {object}
 */
function shapeTotals(row) {
    const base = row || {};
    return {
        ...shapeCounters(base),
        players: toInt(base.players),
        locations: toInt(base.locations),
        first_play_at: base.first_play_at ?? null,
        last_play_at: base.last_play_at ?? null,
    };
}

module.exports = {
    toDateKey,
    toLocationId,
    shapeMediaRow,
    shapeLocationRow,
    shapePlayerRow,
    shapeDayRow,
    shapeTotals,
};
