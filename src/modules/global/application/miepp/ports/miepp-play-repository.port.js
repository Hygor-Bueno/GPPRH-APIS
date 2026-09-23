/**
 * @fileoverview Porta do proof-of-play (`miepp_media_plays` e
 * `miepp_media_play_daily`).
 *
 * Mora em `application/miepp/ports/` com o prefixo da suite, como a porta de
 * auditoria e a de player: é usada por DUAS sub-features com donos diferentes —
 * o dispositivo escreve (`device`) e o painel lê (`play`) — e não pertence a
 * nenhuma das duas.
 *
 * ─── A divisão de trabalho entre as duas tabelas ─────────────────────────────
 *
 * `recordPlays` escreve nas duas na mesma transação. TODA leitura de relatório
 * vem do ACUMULADO (`miepp_media_play_daily`); a única que toca o evento cru é
 * `listPlaysForPlayer`, que é evidência de caso específico e some na purga. Ver
 * `miepp-play-log.sql` para o porquê.
 *
 * @module modules/global/application/miepp/ports/miepp-play-repository.port
 */

class MieppPlayRepositoryPort {
    /**
     * Resolve os UUIDs de mídia que o player reportou.
     *
     * Em uma consulta, não uma por evento: um lote de 200 exibições costuma
     * citar meia dúzia de mídias, e 200 idas ao banco para descobrir isso
     * seriam gastas à toa.
     *
     * @param {string[]} uuids
     * @returns {Promise<Array<{id: number, uuid: string, title: string}>>}
     *          Só as que existem — o caso de uso recusa as demais com
     *          `unknown_media`.
     */
    resolveMediaByUuids(uuids) { throw new Error('Not implemented'); }

    /**
     * Grava o lote de exibições.
     *
     * Idempotente por `event_uuid`: reenviar o mesmo lote não soma duas vezes,
     * nem no cru nem no acumulado. O retorno separa o que entrou do que já
     * estava lá, porque é isso que o dispositivo precisa saber para limpar a
     * fila local.
     *
     * @param {object}   batch
     * @param {number}   batch.playerId
     * @param {number|null} batch.locationId - local do player NO INGEST; vira
     *        snapshot e nunca é recalculado na leitura.
     * @param {object[]} batch.plays - eventos já normalizados por
     *        `play-event.rules`, com `media_id` e `media_title` resolvidos.
     * @returns {Promise<{accepted: string[], duplicated: string[]}>} `event_uuid`s.
     */
    recordPlays(batch) { throw new Error('Not implemented'); }

    /**
     * Ranking do período: uma linha por mídia.
     *
     * @param {object} filters - `{ from, to, mediaId, locationId, playerId, limit, offset }`
     * @returns {Promise<{rows: object[], total: number}>}
     */
    listMediaTotals(filters) { throw new Error('Not implemented'); }

    /**
     * Totais de UMA mídia no período, ou `null` quando ela nunca foi exibida.
     *
     * @param {object} filters - `{ mediaId, from, to }`
     * @returns {Promise<object|null>}
     */
    findMediaTotals(filters) { throw new Error('Not implemented'); }

    /**
     * "Em quais LOCAIS essa mídia passou", no período.
     * @param {object} filters - `{ mediaId, from, to }`
     * @returns {Promise<object[]>}
     */
    listLocationsForMedia(filters) { throw new Error('Not implemented'); }

    /**
     * "Em quais TELAS essa mídia passou", no período.
     * @param {object} filters - `{ mediaId, from, to }`
     * @returns {Promise<object[]>}
     */
    listPlayersForMedia(filters) { throw new Error('Not implemented'); }

    /**
     * Série diária de uma mídia no período.
     * @param {object} filters - `{ mediaId, from, to }`
     * @returns {Promise<object[]>}
     */
    listDaysForMedia(filters) { throw new Error('Not implemented'); }

    /**
     * Eventos CRUS de uma tela — a evidência de "o que essa tela tocou às
     * 14h03". Sujeito à purga do cru; o acumulado não responde isso.
     *
     * @param {object} filters - `{ playerId, from, to, mediaId, limit, offset }`
     * @returns {Promise<{rows: object[], total: number}>}
     */
    listPlaysForPlayer(filters) { throw new Error('Not implemented'); }
}

module.exports = { MieppPlayRepositoryPort };
