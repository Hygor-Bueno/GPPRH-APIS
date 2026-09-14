/**
 * @fileoverview Consultas SQL puras para `meipp_media`.
 *
 * `file_id` guarda o id de `global._files` (o mesmo sistema de upload usado por
 * chat e GTPP) quando o tipo tem binário, e a URL externa quando o tipo é
 * `weburl`. A coluna é VARCHAR(100) no schema justamente para acomodar os dois
 * — ver `infrastructure/meipp/meipp-media-storage.service.js`.
 *
 * @module modules/global/repositories/mysql/meipp-media.queries
 */

const COLUMNS = `
    id, uuid, title, type, file_id, mime_type, size_bytes, duration_seconds,
    checksum, status, uploaded_by, created_at, updated_at
`;

/**
 * Parâmetros: `[type, type, status, status, limit, offset]`
 */
const SQL_LIST_MEDIA = `
    SELECT ${COLUMNS}
    FROM meipp_media
    WHERE (? IS NULL OR type = ?)
      AND (? IS NULL OR status = ?)
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
`;

const SQL_COUNT_MEDIA = `
    SELECT COUNT(*) AS total
    FROM meipp_media
    WHERE (? IS NULL OR type = ?)
      AND (? IS NULL OR status = ?)
`;

const SQL_GET_MEDIA_BY_ID = `
    SELECT ${COLUMNS} FROM meipp_media WHERE id = ?
`;

/** A rota de entrega assinada resolve a mídia pelo uuid público, nunca pelo id. */
const SQL_GET_MEDIA_BY_UUID = `
    SELECT ${COLUMNS} FROM meipp_media WHERE uuid = ?
`;

const SQL_INSERT_MEDIA = `
    INSERT INTO meipp_media
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
    UPDATE meipp_media
    SET title = ?, duration_seconds = ?, status = ?
    WHERE id = ?
`;

const SQL_UPDATE_MEDIA_STATUS = `
    UPDATE meipp_media SET status = ? WHERE id = ?
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
 * para o meipp.
 *
 * `file_id` é VARCHAR (guarda o id de `_files` ou uma URL), então o parâmetro
 * vai como **string** — comparar a coluna com número forçaria conversão
 * implícita e descartaria o índice.
 *
 * Parâmetros: `[status, file_id]`
 */
const SQL_SET_MEDIA_STATUS_BY_FILE = `
    UPDATE meipp_media SET status = ? WHERE file_id = ? AND type <> 'weburl'
`;

const SQL_DELETE_MEDIA = `
    DELETE FROM meipp_media WHERE id = ?
`;

/**
 * Em quantas playlists a mídia está? Guarda do DELETE: `meipp_playlist_items`
 * tem ON DELETE CASCADE, então apagar a mídia arrancaria o item de toda
 * playlist em silêncio.
 */
const SQL_COUNT_MEDIA_USAGE = `
    SELECT COUNT(*) AS total FROM meipp_playlist_items WHERE media_id = ?
`;

module.exports = {
    SQL_LIST_MEDIA,
    SQL_COUNT_MEDIA,
    SQL_GET_MEDIA_BY_ID,
    SQL_GET_MEDIA_BY_UUID,
    SQL_INSERT_MEDIA,
    SQL_UPDATE_MEDIA,
    SQL_UPDATE_MEDIA_STATUS,
    SQL_SET_MEDIA_STATUS_BY_FILE,
    SQL_DELETE_MEDIA,
    SQL_COUNT_MEDIA_USAGE,
};
