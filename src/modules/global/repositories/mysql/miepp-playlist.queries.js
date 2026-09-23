/**
 * @fileoverview Consultas SQL puras para `miepp_playlists` e `miepp_playlist_items`.
 *
 * @module modules/global/repositories/mysql/miepp-playlist.queries
 */

const SQL_LIST_PLAYLISTS = `
    SELECT pl.id, pl.name, pl.description, pl.active, pl.created_by,
           pl.created_at, pl.updated_at,
           COUNT(i.id) AS item_count
    FROM miepp_playlists pl
    LEFT JOIN miepp_playlist_items i ON i.playlist_id = pl.id
    WHERE (? IS NULL OR pl.active = ?)
    GROUP BY pl.id
    ORDER BY pl.name
    LIMIT ? OFFSET ?
`;

const SQL_COUNT_PLAYLISTS = `
    SELECT COUNT(*) AS total
    FROM miepp_playlists
    WHERE (? IS NULL OR active = ?)
`;

const SQL_GET_PLAYLIST_BY_ID = `
    SELECT id, name, description, active, created_by, created_at, updated_at
    FROM miepp_playlists
    WHERE id = ?
`;

const SQL_INSERT_PLAYLIST = `
    INSERT INTO miepp_playlists (name, description, active, created_by)
    VALUES (?, ?, ?, ?)
`;

const SQL_UPDATE_PLAYLIST = `
    UPDATE miepp_playlists SET name = ?, description = ?, active = ? WHERE id = ?
`;

const SQL_DELETE_PLAYLIST = `
    DELETE FROM miepp_playlists WHERE id = ?
`;

/**
 * Quantos agendamentos usam a playlist. Guarda do DELETE: a FK
 * `fk_miepp_schedules_playlist` é ON DELETE CASCADE, então apagar a playlist
 * apagaria os agendamentos junto — e a tela pararia de tocar sem nenhum aviso.
 */
const SQL_COUNT_PLAYLIST_USAGE = `
    SELECT COUNT(*) AS total FROM miepp_schedules WHERE playlist_id = ?
`;

// ─── Itens ───────────────────────────────────────────────────────────────────

/**
 * Validade RESTANTE do conteúdo do item, em segundos — não o prazo nominal.
 *
 * Só grade de produtos tem validade: ela mostra PREÇO, e preço que o servidor
 * não reconfere há tempo demais não pode continuar na parede. Mídia comum
 * (institucional, campanha) não vence e recebe NULL.
 *
 * O relógio que conta é o da última consulta ao Consinco (`last_checked_at`),
 * não o do download: se a tela baixa uma grade de prazo 20 min dezoito minutos
 * depois da última checagem, aquele arquivo vale 2 min, não 20.
 *
 * `last_checked_at IS NULL` = grade recém-criada, nunca foi ao Consinco e não
 * tem preço nenhum para mostrar → zero. É o mesmo critério do
 * `GRID_STALE_EXPRESSION` de `miepp-product-grid.queries`, e os dois precisam
 * continuar concordando: lá decide o que o painel marca como vencido, aqui o
 * que a tela pode exibir.
 *
 * Sai como DURAÇÃO e não como instante, de propósito. O MySQL roda em -03 e o
 * `resolved_at` da resposta nasce em UTC no Node; `NOW()` e `last_checked_at`
 * vêm do mesmo relógio, então a subtração está certa sem nenhuma conversão — e
 * o que chega ao player não tem fuso para interpretar errado.
 */
const ITEM_MAX_AGE_EXPRESSION = `
    CASE
        WHEN g.id IS NULL THEN NULL
        WHEN g.last_checked_at IS NULL THEN 0
        ELSE GREATEST(
            0,
            g.stale_after_minutes * 60 - TIMESTAMPDIFF(SECOND, g.last_checked_at, NOW())
        )
    END
`;

/**
 * Itens de uma playlist com a mídia resolvida. É o insumo de
 * `domain/miepp/playlist/playlist-item.shaper` — os nomes das colunas do SELECT
 * (`item_id`, `media_uuid`, `grid_id`, `max_age_seconds`) são o contrato com
 * aquele módulo.
 *
 * O LEFT JOIN com `miepp_product_grids` é o que diz se a mídia foi GERADA pelo
 * servidor ou ENVIADA pelo painel. A relação é 1:1
 * (`uq_miepp_product_grids_media`), então o join não multiplica linha. Não
 * existe coluna `origin` em `miepp_media` e não deve existir: seria um
 * denormalizado com uma única fonte de verdade — este join — para discordar.
 */
const SQL_GET_PLAYLIST_ITEMS = `
    SELECT i.id AS item_id, i.playlist_id, i.media_id, i.order_index,
           i.duration_override, i.transition,
           m.uuid AS media_uuid, m.title, m.type, m.mime_type, m.size_bytes,
           m.duration_seconds, m.checksum, m.status, m.file_id,
           g.id AS grid_id,
           ${ITEM_MAX_AGE_EXPRESSION} AS max_age_seconds
    FROM miepp_playlist_items i
    INNER JOIN miepp_media m ON m.id = i.media_id
    LEFT JOIN miepp_product_grids g ON g.media_id = m.id
    WHERE i.playlist_id = ?
    ORDER BY i.order_index, i.id
`;

/**
 * Próxima posição livre da playlist.
 *
 * `COALESCE(MAX(...) + 1, 0)` e não `COUNT(*)`: depois de remover um item do
 * meio, a contagem repetiria uma posição já ocupada.
 */
const SQL_NEXT_ITEM_ORDER = `
    SELECT COALESCE(MAX(order_index) + 1, 0) AS next_order
    FROM miepp_playlist_items
    WHERE playlist_id = ?
`;

const SQL_INSERT_PLAYLIST_ITEM = `
    INSERT INTO miepp_playlist_items
        (playlist_id, media_id, order_index, duration_override, transition)
    VALUES (?, ?, ?, ?, ?)
`;

const SQL_UPDATE_PLAYLIST_ITEM = `
    UPDATE miepp_playlist_items
    SET duration_override = ?, transition = ?
    WHERE id = ? AND playlist_id = ?
`;

const SQL_DELETE_PLAYLIST_ITEM = `
    DELETE FROM miepp_playlist_items WHERE id = ? AND playlist_id = ?
`;

/**
 * Um passo da reordenação. O caso de uso chama isto uma vez por item, dentro de
 * uma transação — `playlist_id` no WHERE impede que um id de outra playlist se
 * infiltre no payload e seja reordenado junto.
 *
 * Parâmetros: `[order_index, item_id, playlist_id]`
 */
const SQL_SET_ITEM_ORDER = `
    UPDATE miepp_playlist_items SET order_index = ? WHERE id = ? AND playlist_id = ?
`;

/** Ids atuais da playlist — usado para validar o payload de reordenação. */
const SQL_GET_PLAYLIST_ITEM_IDS = `
    SELECT id FROM miepp_playlist_items WHERE playlist_id = ?
`;

module.exports = {
    ITEM_MAX_AGE_EXPRESSION,
    SQL_LIST_PLAYLISTS,
    SQL_COUNT_PLAYLISTS,
    SQL_GET_PLAYLIST_BY_ID,
    SQL_INSERT_PLAYLIST,
    SQL_UPDATE_PLAYLIST,
    SQL_DELETE_PLAYLIST,
    SQL_COUNT_PLAYLIST_USAGE,
    SQL_GET_PLAYLIST_ITEMS,
    SQL_NEXT_ITEM_ORDER,
    SQL_INSERT_PLAYLIST_ITEM,
    SQL_UPDATE_PLAYLIST_ITEM,
    SQL_DELETE_PLAYLIST_ITEM,
    SQL_SET_ITEM_ORDER,
    SQL_GET_PLAYLIST_ITEM_IDS,
};
