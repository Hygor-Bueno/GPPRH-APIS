/**
 * @fileoverview Adapter MySQL do proof-of-play.
 *
 * @module modules/global/infrastructure/miepp/mysql-miepp-play.repository
 */

const { MieppPlayRepositoryPort } = require('../../application/miepp/ports/miepp-play-repository.port');
const { query, count, transaction } = require('./miepp-mysql.helper');
const {
    SQL_RESOLVE_MEDIA_BY_UUIDS,
    SQL_INSERT_PLAY,
    SQL_UPSERT_PLAY_DAILY,
    SQL_LIST_MEDIA_TOTALS,
    SQL_COUNT_MEDIA_TOTALS,
    SQL_GET_MEDIA_TOTALS,
    SQL_LIST_MEDIA_BY_LOCATION,
    SQL_LIST_MEDIA_BY_PLAYER,
    SQL_LIST_MEDIA_BY_DAY,
    SQL_LIST_PLAYER_PLAYS,
    SQL_COUNT_PLAYER_PLAYS,
} = require('../../repositories/mysql/miepp-play.queries');

/**
 * `location_id` do ACUMULADO é NOT NULL com 0 = "sem local". O motivo está no
 * DDL: em chave única, dois NULLs não são iguais, então uma tela sem local
 * cadastrado criaria uma linha nova por exibição em vez de somar.
 */
const NO_LOCATION = 0;

class MysqlMieppPlayRepository extends MieppPlayRepositoryPort {
    async resolveMediaByUuids(uuids) {
        if (!Array.isArray(uuids) || uuids.length === 0) return [];
        // O array vai DENTRO do array de parâmetros: é assim que o `query()`
        // expande `IN (?)`. Ver o cabeçalho da consulta.
        return query(SQL_RESOLVE_MEDIA_BY_UUIDS, [uuids]);
    }

    /**
     * Grava o lote inteiro numa transação, evento por evento.
     *
     * ─── Por que evento por evento, e não um INSERT multi-VALUES ────────────
     *
     * Um INSERT com 200 tuplas seria uma ida ao banco em vez de 200, mas
     * devolveria um `affectedRows` agregado — e aí não há como saber QUAIS
     * eventos entraram. Sem isso não se pode somar o acumulado só dos novos, e
     * o reenvio de um lote parcialmente conhecido (o caso comum: o player
     * reenvia porque a resposta se perdeu, e metade já estava lá) dobraria a
     * contagem da outra metade.
     *
     * A conta fechada: 200 eventos = 400 comandos, que no LAN cabem folgados
     * no timeout de 15s do pool. O teto de 200 por lote
     * (`MAX_PLAYS_PER_BATCH`) existe para manter essa conta válida.
     *
     * Tudo numa transação porque acumulado e evento cru não podem discordar: se
     * o processo cair entre o INSERT e o UPSERT, o relatório passaria a mostrar
     * menos exibições do que a evidência crua lista, e a conferência do
     * `miepp-play-log.sql` acusaria para sempre.
     */
    async recordPlays({ playerId, locationId, plays }) {
        if (!Array.isArray(plays) || plays.length === 0) {
            return { accepted: [], duplicated: [] };
        }

        const rawLocation = Number.isInteger(locationId) && locationId > 0 ? locationId : null;
        const dailyLocation = rawLocation ?? NO_LOCATION;

        return transaction(async (conn) => {
            const accepted = [];
            const duplicated = [];

            for (const play of plays) {
                const [result] = await conn.query(SQL_INSERT_PLAY, [
                    play.event_uuid,
                    playerId,
                    rawLocation,
                    play.media_id,
                    play.media_title ?? null,
                    play.playlist_id,
                    play.schedule_id,
                    play.started_at,
                    play.duration_ms,
                    play.completed,
                ]);

                // 0 = a UNIQUE de `event_uuid` absorveu um reenvio. Não soma no
                // acumulado, e não é erro: o dado já está gravado.
                if (Number(result.affectedRows) === 0) {
                    duplicated.push(play.event_uuid);
                    continue;
                }

                await conn.query(SQL_UPSERT_PLAY_DAILY, [
                    play.play_date,
                    play.media_id,
                    playerId,
                    dailyLocation,
                    play.media_title ?? null,
                    play.completed,
                    play.duration_ms,
                    play.started_at,
                    play.started_at,
                ]);

                accepted.push(play.event_uuid);
            }

            return { accepted, duplicated };
        });
    }

    /** @private Parâmetros dos filtros opcionais, na ordem de `PLAY_FILTERS`. */
    static _reportFilters({ from, to, mediaId = null, locationId = null, playerId = null }) {
        return [
            from, to,
            mediaId ?? null, mediaId ?? null,
            locationId ?? null, locationId ?? null,
            playerId ?? null, playerId ?? null,
        ];
    }

    async listMediaTotals({ from, to, mediaId, locationId, playerId, limit, offset }) {
        const filters = MysqlMieppPlayRepository._reportFilters({
            from, to, mediaId, locationId, playerId,
        });

        const [rows, total] = await Promise.all([
            query(SQL_LIST_MEDIA_TOTALS, [...filters, limit, offset]),
            count(SQL_COUNT_MEDIA_TOTALS, filters),
        ]);

        return { rows, total };
    }

    /**
     * A agregação sem GROUP BY devolve sempre uma linha; quando não houve
     * exibição, os `SUM` vêm NULL. Traduzir isso para `null` aqui é o que
     * permite ao caso de uso distinguir "nunca passou" de "passou zero vezes",
     * que na prática é a diferença entre 404 e um relatório zerado.
     */
    async findMediaTotals({ mediaId, from, to }) {
        const rows = await query(SQL_GET_MEDIA_TOTALS, [mediaId, from, to]);
        const row = rows[0];
        if (!row || row.plays === null || row.plays === undefined) return null;
        return row;
    }

    async listLocationsForMedia({ mediaId, from, to }) {
        return query(SQL_LIST_MEDIA_BY_LOCATION, [mediaId, from, to]);
    }

    async listPlayersForMedia({ mediaId, from, to }) {
        return query(SQL_LIST_MEDIA_BY_PLAYER, [mediaId, from, to]);
    }

    async listDaysForMedia({ mediaId, from, to }) {
        return query(SQL_LIST_MEDIA_BY_DAY, [mediaId, from, to]);
    }

    async listPlaysForPlayer({ playerId, from, to, mediaId = null, limit, offset }) {
        const filters = [playerId, from, to, mediaId ?? null, mediaId ?? null];

        const [rows, total] = await Promise.all([
            query(SQL_LIST_PLAYER_PLAYS, [...filters, limit, offset]),
            count(SQL_COUNT_PLAYER_PLAYS, filters),
        ]);

        return { rows, total };
    }
}

module.exports = { MysqlMieppPlayRepository, NO_LOCATION };
