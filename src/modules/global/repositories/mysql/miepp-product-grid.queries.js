/**
 * @fileoverview Consultas SQL puras da grade de produtos.
 *
 * Três tabelas: `miepp_product_grids` (a curadoria), `miepp_product_grid_items`
 * (os PLUs escolhidos) e `miepp_product_grid_renders` (a trilha do que foi
 * exibido). Nenhuma delas guarda dado de produto — descrição e preço vêm do
 * Consinco no momento do render.
 *
 * A grade tem 1:1 com `miepp_media`: toda leitura faz JOIN, porque título,
 * status e duração moram lá. É o que permite ao player tratar a grade como uma
 * imagem qualquer, sem saber que ela existe.
 *
 * @module modules/global/repositories/mysql/miepp-product-grid.queries
 */

/**
 * `stale` derivado na LEITURA, não coluna.
 *
 * Mesmo raciocínio do `PLAYER_STATUS_EXPRESSION`: quem marcaria a grade como
 * vencida seria o renderizador, e é justamente quando ele morre que a grade
 * vence. Uma coluna escrita por ele responderia "em dia" para sempre.
 *
 * `last_checked_at IS NULL` conta como vencida: grade recém-criada nunca foi ao
 * Consinco e não tem preço nenhum para mostrar.
 */
const GRID_STALE_EXPRESSION = `
    CASE
        WHEN g.last_checked_at IS NULL THEN 1
        WHEN g.last_checked_at < NOW() - INTERVAL g.stale_after_minutes MINUTE THEN 1
        ELSE 0
    END
`;

const GRID_COLUMNS = `
    g.id, g.media_id, g.shop_id, g.background_file_id,
    g.grid_columns, g.grid_rows, g.stale_after_minutes, g.style,
    g.data_hash, g.last_checked_at, g.last_rendered_at, g.last_error,
    g.active, g.created_by, g.created_at, g.updated_at,
    ${GRID_STALE_EXPRESSION} AS stale,
    m.uuid AS media_uuid, m.title, m.status AS media_status, m.duration_seconds
`;

/** Parâmetros: `[active, active, shop_id, shop_id, limit, offset]` */
const SQL_LIST_GRIDS = `
    SELECT ${GRID_COLUMNS}
    FROM miepp_product_grids g
    JOIN miepp_media m ON m.id = g.media_id
    WHERE (? IS NULL OR g.active = ?)
      AND (? IS NULL OR g.shop_id = ?)
    ORDER BY g.created_at DESC
    LIMIT ? OFFSET ?
`;

const SQL_COUNT_GRIDS = `
    SELECT COUNT(*) AS total
    FROM miepp_product_grids g
    WHERE (? IS NULL OR g.active = ?)
      AND (? IS NULL OR g.shop_id = ?)
`;

const SQL_GET_GRID_BY_ID = `
    SELECT ${GRID_COLUMNS}
    FROM miepp_product_grids g
    JOIN miepp_media m ON m.id = g.media_id
    WHERE g.id = ?
`;

const SQL_GET_GRID_ITEMS = `
    SELECT plu, order_index, label_override
    FROM miepp_product_grid_items
    WHERE grid_id = ?
    ORDER BY order_index
`;

// ─── Escrita ─────────────────────────────────────────────────────────────────

/**
 * A mídia da grade nasce sem binário: `file_id`, `checksum`, `mime_type` e
 * `size_bytes` são NULL e o status é `processing`, não `ready`.
 *
 * Isso não é rascunho — é o que impede a grade de ir para a tela antes de
 * existir imagem. O `isPlayable` do shaper só deixa passar `ready`, então uma
 * grade sem render é descartada da playlist em silêncio, que é o comportamento
 * certo para uma grade que mostra preço.
 *
 * Parâmetros: `[uuid, title, duration_seconds, uploaded_by]`
 */
const SQL_INSERT_GRID_MEDIA = `
    INSERT INTO miepp_media
        (uuid, title, type, file_id, mime_type, size_bytes, duration_seconds,
         checksum, status, uploaded_by)
    VALUES (?, ?, 'image', NULL, NULL, NULL, ?, NULL, 'processing', ?)
`;

/** Parâmetros: `[media_id, shop_id, grid_columns, grid_rows, stale_after_minutes, style, active, created_by]` */
const SQL_INSERT_GRID = `
    INSERT INTO miepp_product_grids
        (media_id, shop_id, grid_columns, grid_rows, stale_after_minutes, style, active, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

/** Parâmetros: `[grid_id, plu, order_index, label_override]` */
const SQL_INSERT_GRID_ITEM = `
    INSERT INTO miepp_product_grid_items (grid_id, plu, order_index, label_override)
    VALUES (?, ?, ?, ?)
`;

/**
 * `data_hash` vai a NULL junto com a atualização da curadoria.
 *
 * Trocar produto, ordem, loja, layout ou estilo muda o que a imagem deveria
 * mostrar, mas o hash guardado ainda descreve a imagem ANTIGA — o renderizador
 * compararia o Consinco com ela, veria "nada mudou" e deixaria a grade velha no
 * ar. Zerar aqui é o que garante o próximo render.
 *
 * Parâmetros: `[shop_id, grid_columns, grid_rows, stale_after_minutes, style, active, id]`
 */
const SQL_UPDATE_GRID = `
    UPDATE miepp_product_grids
    SET shop_id             = ?,
        grid_columns        = ?,
        grid_rows           = ?,
        stale_after_minutes = ?,
        style               = ?,
        active              = ?,
        data_hash           = NULL
    WHERE id = ?
`;

/** O título da grade é o título da mídia — não há duplicata. */
const SQL_UPDATE_GRID_MEDIA_TITLE = `
    UPDATE miepp_media SET title = ?, duration_seconds = ? WHERE id = ?
`;

/** Parâmetros: `[background_file_id, id]` */
const SQL_UPDATE_GRID_BACKGROUND = `
    UPDATE miepp_product_grids
    SET background_file_id = ?, data_hash = NULL
    WHERE id = ?
`;

const SQL_DELETE_GRID_ITEMS = `
    DELETE FROM miepp_product_grid_items WHERE grid_id = ?
`;

/**
 * Força o próximo ciclo a renderizar, zerando a impressão digital.
 *
 * Não renderiza nada por si: quem lê `data_hash IS NULL` é o job de render.
 */
const SQL_CLEAR_GRID_DATA_HASH = `
    UPDATE miepp_product_grids SET data_hash = NULL, last_error = NULL WHERE id = ?
`;

/**
 * Apaga a MÍDIA, não a grade.
 *
 * `miepp_product_grids.media_id` tem ON DELETE CASCADE, então remover a mídia
 * leva grade, itens e trilha de renders junto. O caminho inverso deixaria uma
 * mídia órfã em `processing` para sempre na biblioteca.
 */
const SQL_DELETE_GRID_MEDIA = `
    DELETE FROM miepp_media WHERE id = ?
`;

/**
 * Guarda do DELETE: `miepp_playlist_items` tem ON DELETE CASCADE para a mídia,
 * então apagar uma grade em uso arrancaria o item de toda playlist sem avisar.
 * Mesma proteção que `SQL_COUNT_MEDIA_USAGE` dá à mídia comum.
 */
const SQL_COUNT_GRID_USAGE = `
    SELECT COUNT(*) AS total FROM miepp_playlist_items WHERE media_id = ?
`;

// ─── Ciclo de render ─────────────────────────────────────────────────────────

/**
 * Grades que o renderizador deve visitar, mais antiga primeiro.
 *
 * `last_checked_at IS NULL` vem antes de tudo (grade recém-criada nunca foi ao
 * Consinco), e o resto por ordem de última visita. Só `active = 1`: desativar a
 * grade no painel é o jeito de tirá-la do ciclo sem excluí-la.
 *
 * Parâmetros: `[limit]`
 */
const SQL_LIST_GRIDS_TO_RENDER = `
    SELECT g.id, g.media_id, g.shop_id, g.background_file_id,
           g.grid_columns, g.grid_rows, g.style, g.data_hash,
           m.title, m.status AS media_status
      FROM miepp_product_grids g
      JOIN miepp_media m ON m.id = g.media_id
     WHERE g.active = 1
     ORDER BY g.last_checked_at IS NULL DESC, g.last_checked_at ASC, g.id ASC
     LIMIT ?
`;

/**
 * Consulta feita, conteúdo idêntico ao do último render.
 *
 * Mexe só em `last_checked_at`: `last_rendered_at` continua antigo de
 * propósito. A distância entre os dois é a informação — "consultado há 2 min,
 * sem alteração desde 11:20" é o que evita o chamado de suporte achando que o
 * job travou.
 */
const SQL_MARK_GRID_CHECKED = `
    UPDATE miepp_product_grids
    SET last_checked_at = NOW(), last_error = NULL
    WHERE id = ?
`;

/**
 * Consulta feita, e a grade não pode ir ao ar.
 *
 * `last_checked_at` É atualizado: o job está vivo e consultou, então a grade não
 * está "vencida" — está quebrada, que é outra coisa. Quem a tira da tela é o
 * `status = 'error'` da mídia, aplicado logo em seguida.
 *
 * Parâmetros: `[last_error, id]`
 */
const SQL_MARK_GRID_OFF_AIR = `
    UPDATE miepp_product_grids
    SET last_checked_at = NOW(), last_error = ?, data_hash = NULL
    WHERE id = ?
`;

/**
 * O ciclo FALHOU — Consinco fora, Chromium morto, disco cheio.
 *
 * `last_checked_at` **não** é tocado, e essa é a diferença que importa em
 * relação ao `OFF_AIR`: nós não conseguimos consultar, então a grade fica cada
 * vez mais velha até cruzar `stale_after_minutes` e sair da playlist sozinha.
 * Carimbar a hora aqui seria mentir que os preços foram conferidos, e a grade
 * seguiria no ar com o preço de ontem enquanto o Oracle estivesse fora.
 *
 * Parâmetros: `[last_error, id]`
 */
const SQL_MARK_GRID_FAILED = `
    UPDATE miepp_product_grids SET last_error = ? WHERE id = ?
`;

/** Parâmetros: `[data_hash, id]` */
const SQL_MARK_GRID_RENDERED = `
    UPDATE miepp_product_grids
    SET data_hash        = ?,
        last_checked_at  = NOW(),
        last_rendered_at = NOW(),
        last_error       = NULL
    WHERE id = ?
`;

/**
 * Troca o binário da mídia da grade e a coloca no ar.
 *
 * O `uuid` NÃO muda — é o que mantém playlist e agendamento apontando para o
 * mesmo item entre renders. O que muda é o `checksum`, e é por ele que o player
 * decide rebaixar. (Se o app Android comparar a URL em vez do checksum, a tela
 * congela na primeira versão e nada no log acusa — ver `docs/miepp.md`.)
 *
 * Parâmetros: `[file_id, mime_type, size_bytes, checksum, media_id]`
 */
const SQL_SET_GRID_MEDIA_FILE = `
    UPDATE miepp_media
    SET file_id    = ?,
        mime_type  = ?,
        size_bytes = ?,
        checksum   = ?,
        status     = 'ready'
    WHERE id = ?
`;

/** Parâmetros: `[status, media_id]` */
const SQL_SET_GRID_MEDIA_STATUS = `
    UPDATE miepp_media SET status = ? WHERE id = ?
`;

/**
 * Grava a trilha. Uma linha por render EFETIVO — o ciclo que não muda nada não
 * escreve aqui, então a tabela cresce com a mudança de preço e não com a
 * cadência do job.
 *
 * Parâmetros: `[grid_id, data_hash, file_id, checksum, snapshot]`
 */
const SQL_INSERT_GRID_RENDER = `
    INSERT INTO miepp_product_grid_renders
        (grid_id, data_hash, file_id, checksum, snapshot)
    VALUES (?, ?, ?, ?, ?)
`;

// ─── Trilha de renders ───────────────────────────────────────────────────────

/**
 * Só de leitura por aqui. Quem insere é o renderizador, e nenhuma rota escreve
 * nesta tabela — trilha que aceita escrita pela API deixa de valer como
 * evidência (mesma regra do `miepp_audit_log`).
 *
 * Parâmetros: `[grid_id, limit, offset]`
 */
const SQL_LIST_GRID_RENDERS = `
    SELECT id, grid_id, data_hash, file_id, checksum, snapshot, rendered_at
    FROM miepp_product_grid_renders
    WHERE grid_id = ?
    ORDER BY rendered_at DESC, id DESC
    LIMIT ? OFFSET ?
`;

const SQL_COUNT_GRID_RENDERS = `
    SELECT COUNT(*) AS total FROM miepp_product_grid_renders WHERE grid_id = ?
`;

module.exports = {
    GRID_STALE_EXPRESSION,
    SQL_LIST_GRIDS,
    SQL_COUNT_GRIDS,
    SQL_GET_GRID_BY_ID,
    SQL_GET_GRID_ITEMS,
    SQL_INSERT_GRID_MEDIA,
    SQL_INSERT_GRID,
    SQL_INSERT_GRID_ITEM,
    SQL_UPDATE_GRID,
    SQL_UPDATE_GRID_MEDIA_TITLE,
    SQL_UPDATE_GRID_BACKGROUND,
    SQL_DELETE_GRID_ITEMS,
    SQL_CLEAR_GRID_DATA_HASH,
    SQL_DELETE_GRID_MEDIA,
    SQL_COUNT_GRID_USAGE,
    SQL_LIST_GRID_RENDERS,
    SQL_COUNT_GRID_RENDERS,
    SQL_LIST_GRIDS_TO_RENDER,
    SQL_MARK_GRID_CHECKED,
    SQL_MARK_GRID_OFF_AIR,
    SQL_MARK_GRID_FAILED,
    SQL_MARK_GRID_RENDERED,
    SQL_SET_GRID_MEDIA_FILE,
    SQL_SET_GRID_MEDIA_STATUS,
    SQL_INSERT_GRID_RENDER,
};
