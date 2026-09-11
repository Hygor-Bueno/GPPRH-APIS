/**
 * @fileoverview Montagem pura do payload de resposta/evidência de item (GTPP).
 *
 * Um comentário passou a aceitar N anexos: as linhas vivem em
 * `gt_task_item_response_files` e chegam aqui em uma lista achatada, que este
 * shaper agrupa por comentário.
 *
 * Aqui também ficam os campos legados `file_id`/`file_name`/`file_path`/…, que
 * o payload continua expondo no nível do comentário enquanto o front não migra
 * para `files[]`.
 *
 * @module modules/global/domain/gtpp/task-item-response/task-item-response.shaper
 */

const { WEB_SAFE_VIDEO_CODECS } = require('../../../../../utils/file/video-codec');

/**
 * Um anexo de comentário — uma linha de `gt_task_item_response_files` já
 * cruzada com os metadados de `_files`.
 *
 * @typedef  {Object}       TaskItemResponseFileDTO
 * @property {number}       id             - PK em `gt_task_item_response_files` (é este id que o DELETE de anexo recebe).
 * @property {?number}      file_id        - FK para `_files.id` — use em `GET /files/:fileId` para baixar.
 * @property {?string}      file_name      - Nome original informado no upload.
 * @property {?string}      file_path      - Caminho relativo em `_files`.
 * @property {?string}      file_extension
 * @property {?string}      file_type
 * @property {?number}      file_size
 * @property {?string}      video_codec    - Codec de vídeo (`h264`, `hevc`…). NULL quando não é vídeo.
 * @property {?boolean}     web_playable   - Toca em qualquer navegador/Windows sem instalar codec. NULL quando não é vídeo.
 * @property {string}       processing_status - `pending` | `processing` | `ready` | `failed`. Não-vídeo é sempre `ready`.
 * @property {0|1}          status         - 1 ativo, 0 removido (soft delete).
 * @property {string|Date}  created_at
 */

/**
 * Um comentário/evidência de item já pronto para a resposta HTTP.
 *
 * @typedef  {Object}  TaskItemResponseDTO
 * @property {number}  id
 * @property {number}  task_item_id_fk
 * @property {?string} comment
 * @property {TaskItemResponseFileDTO[]} files - Lista de anexos ativos (vazia quando não há nenhum).
 * @property {0|1}     status
 * @property {number}  created_by_fk
 * @property {string|Date} created_at
 * @property {?string} name           - Nome do autor (`_employee.name`).
 * @property {?number} file_id        - @deprecated Primeiro item de `files` — remover quando o front migrar.
 * @property {?string} file_name      - @deprecated idem.
 * @property {?string} file_path      - @deprecated idem.
 * @property {?string} file_extension - @deprecated idem.
 * @property {?string} file_type      - @deprecated idem.
 * @property {?number} file_size      - @deprecated idem.
 */

/**
 * @deprecated Formato antigo (um único anexo por comentário). Mantido só para
 * não quebrar as telas que ainda leem `file_id`/`file_name` direto do
 * comentário. Remover junto com as colunas `gt_task_item_response.file_id` e
 * `.file_name` assim que o front passar a consumir `files[]`.
 *
 * @param {TaskItemResponseFileDTO[]} files
 * @returns {Object} Campos legados preenchidos com o primeiro anexo, ou nulos.
 */
function buildLegacyFileFields(files) {
    const [first] = files;

    return {
        file_id:        first?.file_id        ?? null,
        file_name:      first?.file_name      ?? null,
        file_path:      first?.file_path      ?? null,
        file_extension: first?.file_extension ?? null,
        file_type:      first?.file_type      ?? null,
        file_size:      first?.file_size      ?? null,
    };
}

/**
 * @param {Object} row - Linha de `gt_task_item_response_files` + `_files`.
 * @returns {TaskItemResponseFileDTO}
 */
function toFileDTO(row) {
    return {
        id:             row.id,
        file_id:        row.file_id        ?? null,
        file_name:      row.file_name      ?? null,
        file_path:      row.file_path      ?? null,
        file_extension: row.file_extension ?? null,
        file_type:      row.file_type      ?? null,
        file_size:      row.file_size      ?? null,
        video_codec:    row.video_codec    ?? null,
        // Derivado no backend de propósito: qual codec toca onde é conhecimento
        // que muda com o tempo e não deve ficar replicado em cada cliente. HEVC
        // hoje não toca no Windows sem o pacote pago da Microsoft — o front usa
        // isto para avisar antes de montar um player que ficaria preto.
        web_playable:   row.video_codec ? WEB_SAFE_VIDEO_CODECS.has(row.video_codec) : null,
        processing_status: row.processing_status ?? 'ready',
        status:         row.status,
        created_at:     row.created_at,
    };
}

/** @param {Object[]} rows @returns {TaskItemResponseFileDTO[]} */
function toFileDTOs(rows = []) {
    return rows.map(toFileDTO);
}

/**
 * Monta um comentário com seus anexos já convertidos em DTO.
 *
 * @param {Object} responseRow - Linha de `gt_task_item_response`.
 * @param {TaskItemResponseFileDTO[]} [files]
 * @returns {TaskItemResponseDTO}
 */
function shapeItemResponse(responseRow, files = []) {
    return {
        ...responseRow,
        files,
        ...buildLegacyFileFields(files),
    };
}

/**
 * Agrupa a lista achatada de anexos por comentário — evita o N+1 de buscar os
 * anexos de cada comentário separadamente.
 *
 * @param {Object[]} responseRows - Linhas de `gt_task_item_response`.
 * @param {Object[]} [fileRows]   - Linhas de `gt_task_item_response_files` com `task_item_response_id_fk`.
 * @returns {TaskItemResponseDTO[]}
 */
function shapeItemResponses(responseRows, fileRows = []) {
    const byResponseId = new Map();

    for (const row of fileRows) {
        const list = byResponseId.get(row.task_item_response_id_fk) ?? [];
        list.push(toFileDTO(row));
        byResponseId.set(row.task_item_response_id_fk, list);
    }

    return responseRows.map(row => shapeItemResponse(row, byResponseId.get(row.id) ?? []));
}

module.exports = {
    buildLegacyFileFields,
    toFileDTO,
    toFileDTOs,
    shapeItemResponse,
    shapeItemResponses,
};
