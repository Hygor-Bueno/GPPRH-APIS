/**
 * @fileoverview Consultas SQL puras para `miepp_media`.
 *
 * `file_id` guarda o id de `global._files` (o mesmo sistema de upload usado por
 * chat e GTPP) quando o tipo tem binário, e a URL externa quando o tipo é
 * `weburl`. A coluna é VARCHAR(100) no schema justamente para acomodar os dois
 * — ver `infrastructure/miepp/miepp-media-storage.service.js`.
 *
 * @module modules/global/repositories/mysql/miepp-media.queries
 */

/**
 * Com o alias `m` porque toda leitura daqui passou a sair de
 * `miepp_media m` — as que fazem o JOIN da grade precisam do prefixo, e um
 * segundo jogo de colunas sem ele só daria duas listas para sair de sincronia.
 */
const COLUMNS = `
    m.id, m.uuid, m.title, m.type, m.file_id, m.mime_type, m.size_bytes,
    m.duration_seconds, m.checksum, m.status, m.uploaded_by, m.created_at,
    m.updated_at
`;

/**
 * O LEFT JOIN que diz se a mídia é uma GRADE renderizada pelo servidor ou um
 * upload do painel.
 *
 * Sem ele a grade se disfarça de imagem comum: ela nasce com `type = 'image'`
 * (de propósito — ver `SQL_INSERT_GRID_MEDIA`), então nada na linha de
 * `miepp_media` a distingue. É 1:1 (`uq_miepp_product_grids_media`), logo não
 * multiplica linha nem desconta do `COUNT`.
 *
 * Não vira coluna `origin` em `miepp_media`: seria um denormalizado com uma
 * única fonte de verdade — este join — para discordar.
 */
const GRID_JOIN = 'LEFT JOIN miepp_product_grids g ON g.media_id = m.id';

/**
 * Filtro por ORIGEM, aplicado sobre o join e não sobre uma coluna.
 *
 * Existe porque a lista é paginada: sem ele o painel que quer "só as grades"
 * (ou "só os uploads") teria que filtrar a página que recebeu, e o resultado
 * seria uma página de 20 com 6 itens. Quem filtra o conjunto é o banco.
 *
 * `NULL` = sem filtro, no mesmo padrão dos outros dois.
 */
const ORIGIN_FILTER = "(? IS NULL OR (? = 'generated') = (g.id IS NOT NULL))";

/**
 * `grid_id` vem do LEFT JOIN e é o que o painel lê para saber que aquela
 * "imagem" é uma grade — e para levar quem clicou ao editor certo.
 *
 * Parâmetros: `[type, type, status, status, origin, origin, limit, offset]`
 */
const SQL_LIST_MEDIA = `
    SELECT ${COLUMNS},
           g.id AS grid_id
    FROM miepp_media m
    ${GRID_JOIN}
    WHERE (? IS NULL OR m.type = ?)
      AND (? IS NULL OR m.status = ?)
      AND ${ORIGIN_FILTER}
    ORDER BY m.created_at DESC
    LIMIT ? OFFSET ?
`;

/**
 * O MESMO `WHERE` da listagem, join incluído: um total que não conhecesse o
 * filtro de origem paginaria em cima de um número que a lista não devolve.
 *
 * Parâmetros: `[type, type, status, status, origin, origin]`
 */
const SQL_COUNT_MEDIA = `
    SELECT COUNT(*) AS total
    FROM miepp_media m
    ${GRID_JOIN}
    WHERE (? IS NULL OR m.type = ?)
      AND (? IS NULL OR m.status = ?)
      AND ${ORIGIN_FILTER}
`;

/**
 * Leva `grid_id` pelo mesmo motivo da listagem — e porque é esta a linha que
 * volta no POST e no PUT de mídia, onde o front precisa do mesmo campo.
 */
const SQL_GET_MEDIA_BY_ID = `
    SELECT ${COLUMNS},
           g.id AS grid_id
    FROM miepp_media m
    ${GRID_JOIN}
    WHERE m.id = ?
`;

/**
 * A rota de entrega assinada resolve a mídia pelo uuid público, nunca pelo id.
 *
 * Sem o join da grade de propósito: aqui a resposta é o BINÁRIO, não JSON —
 * ninguém lê `origin` nesta consulta, e ela roda a cada download de cada tela.
 */
const SQL_GET_MEDIA_BY_UUID = `
    SELECT ${COLUMNS} FROM miepp_media m WHERE m.uuid = ?
`;

/**
 * A mídia de RESERVA, no mesmo formato de linha que
 * `SQL_GET_PLAYLIST_ITEMS` — é o que permite passá-la pelo mesmo shaper do
 * item, em vez de montar um segundo formato de `media` que sairia de sincronia
 * na primeira mudança do contrato.
 *
 * Daí os apelidos: `media_uuid` (e não `uuid`) e o LEFT JOIN da grade, que o
 * shaper lê para derivar o `origin`. O caso de uso recusa reserva com
 * `grid_id` — grade mostra preço e preço não serve de conteúdo perene.
 */
const SQL_GET_DEVICE_MEDIA_BY_ID = `
    SELECT m.id, m.uuid AS media_uuid, m.title, m.type, m.mime_type, m.size_bytes,
           m.duration_seconds, m.checksum, m.status, m.file_id,
           g.id AS grid_id
    FROM miepp_media m
    LEFT JOIN miepp_product_grids g ON g.media_id = m.id
    WHERE m.id = ?
`;

const SQL_INSERT_MEDIA = `
    INSERT INTO miepp_media
        (uuid, title, type, file_id, mime_type, size_bytes, duration_seconds,
         checksum, status, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * Só os campos editáveis pelo painel. `file_id`, `checksum`, `mime_type` e
 * `size_bytes` descrevem o binário e mudam apenas por novo upload — deixá-los
 * fora do UPDATE evita que uma edição de título desalinhe o registro do arquivo.
 */
const SQL_UPDATE_MEDIA = `
    UPDATE miepp_media
    SET title = ?, duration_seconds = ?, status = ?
    WHERE id = ?
`;

const SQL_UPDATE_MEDIA_STATUS = `
    UPDATE miepp_media SET status = ? WHERE id = ?
`;

/**
 * Atualiza o status pelo arquivo de origem — chamada pelo worker de
 * transcodificação de vídeo (`workers/video-transcoder.js`).
 *
 * Sem isto, um vídeo enfileirado para conversão nasceria `processing` e ficaria
 * assim para sempre: nada mais escreveria nessa coluna, e o `isPlayable` do
 * shaper (que exige `ready`) manteria o item fora da playlist do player —
 * silenciosamente, sem erro em lugar nenhum. O worker já faz exatamente isso
 * para os anexos do GTPP (`SQL_SET_ATTACHMENT_STATUS`); esta é a mesma ideia
 * para o miepp.
 *
 * `file_id` é VARCHAR (guarda o id de `_files` ou uma URL), então o parâmetro
 * vai como **string** — comparar a coluna com número forçaria conversão
 * implícita e descartaria o índice.
 *
 * Parâmetros: `[status, file_id]`
 */
const SQL_SET_MEDIA_STATUS_BY_FILE = `
    UPDATE miepp_media SET status = ? WHERE file_id = ? AND type <> 'weburl'
`;

const SQL_DELETE_MEDIA = `
    DELETE FROM miepp_media WHERE id = ?
`;

/**
 * Em quantas playlists a mídia está? Guarda do DELETE: `miepp_playlist_items`
 * tem ON DELETE CASCADE, então apagar a mídia arrancaria o item de toda
 * playlist em silêncio.
 */
const SQL_COUNT_MEDIA_USAGE = `
    SELECT COUNT(*) AS total FROM miepp_playlist_items WHERE media_id = ?
`;

module.exports = {
    SQL_LIST_MEDIA,
    SQL_COUNT_MEDIA,
    SQL_GET_MEDIA_BY_ID,
    SQL_GET_MEDIA_BY_UUID,
    SQL_GET_DEVICE_MEDIA_BY_ID,
    SQL_INSERT_MEDIA,
    SQL_UPDATE_MEDIA,
    SQL_UPDATE_MEDIA_STATUS,
    SQL_SET_MEDIA_STATUS_BY_FILE,
    SQL_DELETE_MEDIA,
    SQL_COUNT_MEDIA_USAGE,
};
