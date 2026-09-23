/**
 * @fileoverview Consultas SQL puras do proof-of-play (`miepp_media_plays` e
 * `miepp_media_play_daily`).
 *
 * As duas tabelas estão no mesmo arquivo porque são escritas na mesma
 * transação e nunca evoluem separadas: acrescentar uma dimensão ao evento cru
 * sem acrescentá-la ao acumulado produziria relatório que não consegue agrupar
 * pelo que foi gravado.
 *
 * ─── De onde cada leitura vem ────────────────────────────────────────────────
 * Todas as consultas de relatório leem o ACUMULADO. A única que toca o evento
 * cru é `SQL_LIST_PLAYER_PLAYS`, e isso é deliberado: o cru tem retenção de
 * ~90 dias (ver `miepp-play-log.sql`), então qualquer relatório construído
 * sobre ele passaria a mentir no dia da primeira purga.
 *
 * @module modules/global/repositories/mysql/miepp-play.queries
 */

/**
 * Resolve os UUIDs que o player reportou em UMA consulta.
 *
 * `IN (?)` com array só funciona porque o helper do módulo usa `pool.query()` e
 * não `pool.execute()` — é o `query()` que expande o array do lado do cliente
 * (a razão está no cabeçalho de `miepp-mysql.helper`). Trocar por `execute()`
 * aqui manda a lista como um único parâmetro e a consulta passa a não achar
 * nada.
 *
 * Parâmetros: `[[uuid, uuid, ...]]` — array DENTRO do array de parâmetros.
 */
const SQL_RESOLVE_MEDIA_BY_UUIDS = `
    SELECT id, uuid, title
    FROM miepp_media
    WHERE uuid IN (?)
`;

/**
 * Grava o evento cru, ignorando reenvio.
 *
 * `ON DUPLICATE KEY UPDATE event_uuid = event_uuid` e não `INSERT IGNORE`, de
 * propósito: `IGNORE` rebaixa a warning QUALQUER erro da linha (violação de FK,
 * truncamento de coluna), e o ingest passaria a perder exibição em silêncio por
 * motivo que não é duplicidade. Com o ON DUPLICATE, só a colisão da UNIQUE é
 * absorvida; o resto continua estourando.
 *
 * O `affectedRows` é o que distingue os dois casos, e é sobre ele que o adapter
 * decide somar ou não no acumulado:
 *   1 → inseriu (exibição nova)
 *   0 → já existia, o UPDATE não mudou nada (reenvio)
 *
 * Parâmetros: `[event_uuid, player_id, location_id, media_id, media_title,
 *               playlist_id, schedule_id, started_at, duration_ms, completed]`
 */
const SQL_INSERT_PLAY = `
    INSERT INTO miepp_media_plays
        (event_uuid, player_id, location_id, media_id, media_title,
         playlist_id, schedule_id, started_at, duration_ms, completed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE event_uuid = event_uuid
`;

/**
 * Soma a exibição no acumulado do dia.
 *
 * Roda SÓ quando o INSERT acima de fato inseriu — é o que impede o reenvio de
 * dobrar a contagem.
 *
 * `LEAST`/`GREATEST` e não "grava se for a primeira": as exibições chegam FORA
 * DE ORDEM. Uma tela que passou a manhã sem rede envia às 15h eventos das 9h,
 * depois de já ter enviado os das 14h — sem `LEAST`, o `first_play_at` ficaria
 * preso no primeiro lote que chegou, não na primeira exibição que aconteceu.
 * Os dois lados são NOT NULL por construção (o `started_at` é obrigatório no
 * evento), então não há o caso de `LEAST(NULL, x)` devolver NULL.
 *
 * `media_title` usa `COALESCE(VALUES(...), media_title)` para que um lote sem
 * título não apague o que já estava lá.
 *
 * Parâmetros: `[play_date, media_id, player_id, location_id, media_title,
 *               completed, duration_ms, started_at, started_at]`
 */
const SQL_UPSERT_PLAY_DAILY = `
    INSERT INTO miepp_media_play_daily
        (play_date, media_id, player_id, location_id, media_title,
         plays, completed_plays, duration_ms, first_play_at, last_play_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
        plays           = plays + 1,
        completed_plays = completed_plays + VALUES(completed_plays),
        duration_ms     = duration_ms + VALUES(duration_ms),
        media_title     = COALESCE(VALUES(media_title), media_title),
        first_play_at   = LEAST(first_play_at, VALUES(first_play_at)),
        last_play_at    = GREATEST(last_play_at, VALUES(last_play_at))
`;

// ─── Relatórios (acumulado) ──────────────────────────────────────────────────

/** Os contadores que TODA consulta de relatório devolve. */
const PLAY_SUMS = `
    SUM(d.plays)               AS plays,
    SUM(d.completed_plays)     AS completed_plays,
    SUM(d.duration_ms)         AS duration_ms,
    MIN(d.first_play_at)       AS first_play_at,
    MAX(d.last_play_at)        AS last_play_at
`;

/** "Em quantas TELAS" — só faz sentido onde o agrupamento não é por player. */
const PLAY_DISTINCT_PLAYERS = `
    COUNT(DISTINCT d.player_id) AS players
`;

/**
 * "Em quantos LOCAIS". O `NULLIF(..., 0)` descarta o sentinela de "sem local":
 * uma tela sem local cadastrado não é um local.
 */
const PLAY_DISTINCT_LOCATIONS = `
    COUNT(DISTINCT NULLIF(d.location_id, 0)) AS locations
`;

/**
 * Filtros opcionais, no padrão `(? IS NULL OR coluna = ?)` do módulo — mantém a
 * consulta única em vez de concatenar SQL condicional.
 */
const PLAY_FILTERS = `
    d.play_date BETWEEN ? AND ?
    AND (? IS NULL OR d.media_id = ?)
    AND (? IS NULL OR d.location_id = ?)
    AND (? IS NULL OR d.player_id = ?)
`;

/**
 * Ranking do período: "quantas vezes cada mídia foi exibida".
 *
 * O LEFT JOIN com `miepp_media` traz o título ATUAL e o uuid; quando a mídia já
 * foi apagada (o DELETE é físico) as duas colunas vêm NULL e o shaper cai no
 * `media_title` gravado no ingest. É por isso que o relatório continua legível
 * depois de a campanha sair do ar.
 *
 * Parâmetros: `[from, to, media_id, media_id, location_id, location_id,
 *               player_id, player_id, limit, offset]`
 */
const SQL_LIST_MEDIA_TOTALS = `
    SELECT d.media_id,
           MAX(d.media_title) AS media_title,
           m.uuid  AS media_uuid,
           m.title AS current_title,
           m.type,
           ${PLAY_SUMS},
           ${PLAY_DISTINCT_PLAYERS},
           ${PLAY_DISTINCT_LOCATIONS}
    FROM miepp_media_play_daily d
    LEFT JOIN miepp_media m ON m.id = d.media_id
    WHERE ${PLAY_FILTERS}
    GROUP BY d.media_id, m.uuid, m.title, m.type
    ORDER BY plays DESC, d.media_id
    LIMIT ? OFFSET ?
`;

/** Parâmetros: os mesmos filtros de `SQL_LIST_MEDIA_TOTALS`, sem limit/offset. */
const SQL_COUNT_MEDIA_TOTALS = `
    SELECT COUNT(DISTINCT d.media_id) AS total
    FROM miepp_media_play_daily d
    WHERE ${PLAY_FILTERS}
`;

/**
 * Totais de UMA mídia no período.
 *
 * Agregação sem GROUP BY: devolve SEMPRE uma linha, com os SUM em NULL quando
 * não houve exibição. O adapter converte esse caso em `null`, que é o que o
 * caso de uso testa para dizer "essa mídia nunca passou".
 *
 * Parâmetros: `[media_id, from, to]`
 */
const SQL_GET_MEDIA_TOTALS = `
    SELECT MAX(d.media_title) AS media_title,
           ${PLAY_SUMS},
           ${PLAY_DISTINCT_PLAYERS},
           ${PLAY_DISTINCT_LOCATIONS}
    FROM miepp_media_play_daily d
    WHERE d.media_id = ?
      AND d.play_date BETWEEN ? AND ?
`;

/**
 * Teto das listas de recorte.
 *
 * Não é paginação: local e tela são dezenas, e o painel mostra a lista inteira.
 * O limite existe para que um cadastro que fugiu do controle não devolva uma
 * resposta de megabytes.
 */
const BREAKDOWN_LIMIT = 500;

/**
 * "Em quais LOCAIS essa mídia passou."
 *
 * Parâmetros: `[media_id, from, to]`
 */
const SQL_LIST_MEDIA_BY_LOCATION = `
    SELECT d.location_id,
           l.name AS location_name,
           ${PLAY_SUMS},
           ${PLAY_DISTINCT_PLAYERS}
    FROM miepp_media_play_daily d
    LEFT JOIN miepp_locations l ON l.id = d.location_id
    WHERE d.media_id = ?
      AND d.play_date BETWEEN ? AND ?
    GROUP BY d.location_id, l.name
    ORDER BY plays DESC, d.location_id
    LIMIT ${BREAKDOWN_LIMIT}
`;

/**
 * "Em quais TELAS essa mídia passou."
 *
 * Agrupa por `(player_id, location_id)` e não só por player: uma tela que mudou
 * de local no período aparece em duas linhas, uma por local. Agrupar só por
 * player esconderia essa mudança e atribuiria as exibições antigas ao local
 * novo — o mesmo erro que o snapshot de `location_id` existe para evitar.
 *
 * Parâmetros: `[media_id, from, to]`
 */
const SQL_LIST_MEDIA_BY_PLAYER = `
    SELECT d.player_id,
           p.name AS player_name,
           d.location_id,
           l.name AS location_name,
           ${PLAY_SUMS}
    FROM miepp_media_play_daily d
    LEFT JOIN miepp_players   p ON p.id = d.player_id
    LEFT JOIN miepp_locations l ON l.id = d.location_id
    WHERE d.media_id = ?
      AND d.play_date BETWEEN ? AND ?
    GROUP BY d.player_id, p.name, d.location_id, l.name
    ORDER BY plays DESC, d.player_id
    LIMIT ${BREAKDOWN_LIMIT}
`;

/**
 * Série diária de uma mídia. Sem LIMIT: a janela já é limitada a
 * `MAX_RANGE_DAYS` por `play-range.rules`, então o máximo é uma linha por dia.
 *
 * Parâmetros: `[media_id, from, to]`
 */
const SQL_LIST_MEDIA_BY_DAY = `
    SELECT d.play_date,
           SUM(d.plays)                AS plays,
           SUM(d.completed_plays)      AS completed_plays,
           SUM(d.duration_ms)          AS duration_ms,
           COUNT(DISTINCT d.player_id) AS players
    FROM miepp_media_play_daily d
    WHERE d.media_id = ?
      AND d.play_date BETWEEN ? AND ?
    GROUP BY d.play_date
    ORDER BY d.play_date
`;

// ─── Evidência (evento cru) ──────────────────────────────────────────────────

/**
 * Exibições CRUAS de uma tela — responde "o que essa tela tocou às 14h03".
 *
 * `DATE_ADD(?, INTERVAL 1 DAY)` com `<` em vez de `BETWEEN`: `started_at` é
 * DATETIME, e `BETWEEN '2026-09-01' AND '2026-09-21'` pararia à meia-noite do
 * dia 21, perdendo o dia inteiro que o operador pediu.
 *
 * Parâmetros: `[player_id, from, to, media_id, media_id, limit, offset]`
 */
const SQL_LIST_PLAYER_PLAYS = `
    SELECT r.id, r.event_uuid, r.media_id, r.media_title,
           m.uuid  AS media_uuid,
           m.title AS current_title,
           r.playlist_id, r.schedule_id, r.location_id,
           l.name  AS location_name,
           r.started_at, r.duration_ms, r.completed, r.reported_at
    FROM miepp_media_plays r
    LEFT JOIN miepp_media     m ON m.id = r.media_id
    LEFT JOIN miepp_locations l ON l.id = r.location_id
    WHERE r.player_id = ?
      AND r.started_at >= ?
      AND r.started_at < DATE_ADD(?, INTERVAL 1 DAY)
      AND (? IS NULL OR r.media_id = ?)
    ORDER BY r.started_at DESC, r.id DESC
    LIMIT ? OFFSET ?
`;

/** Parâmetros: `[player_id, from, to, media_id, media_id]` */
const SQL_COUNT_PLAYER_PLAYS = `
    SELECT COUNT(*) AS total
    FROM miepp_media_plays r
    WHERE r.player_id = ?
      AND r.started_at >= ?
      AND r.started_at < DATE_ADD(?, INTERVAL 1 DAY)
      AND (? IS NULL OR r.media_id = ?)
`;

module.exports = {
    BREAKDOWN_LIMIT,
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
};
