/**
 * @fileoverview Repositório MySQL — Tabela `_files`.
 *
 * Centraliza todas as queries SQL para gerenciamento de arquivos físicos
 * registrados na tabela `global._files`.
 *
 * @module modules/global/repositories/mysql/files.queries
 */

/**
 * Busca um arquivo pelo hash SHA-256 (deduplicação).
 * Retorna o registro existente se o mesmo conteúdo já foi enviado antes.
 *
 * Parâmetros: `[file_hash]`
 *
 * @returns {string}
 */
function sqlFindByHash() {
    return `
        SELECT id, file_path, file_name, file_extension, file_type, file_size, file_hash, video_codec, poster_path, status
        FROM _files
        WHERE file_hash = ? AND status = 1
        LIMIT 1
    `;
}

/**
 * Busca pelo hash em qualquer situação (ativo ou inativo).
 *
 * `file_hash` é único em `_files` (`uq_file_hash`) mesmo depois do soft-delete:
 * reenviar um conteúdo já removido precisa reaproveitar a linha existente
 * (reativando), e não inserir outra — o INSERT esbarraria no índice único.
 *
 * Parâmetros: `[file_hash]`
 *
 * @returns {string}
 */
function sqlFindByHashAnyStatus() {
    return `
        SELECT id, file_path, file_name, file_extension, file_type, file_size, file_hash, video_codec, poster_path, status
        FROM _files
        WHERE file_hash = ?
        LIMIT 1
    `;
}

/**
 * Reativa um arquivo inativo (desfaz o soft-delete) para reaproveitá-lo.
 *
 * Parâmetros: `[updated_by_fk, id]`
 *
 * @returns {string}
 */
function sqlReactivateFile() {
    return `UPDATE _files SET status = 1, updated_by_fk = ? WHERE id = ?`;
}

/**
 * Busca um arquivo pelo ID.
 *
 * Parâmetros: `[id]`
 *
 * @returns {string}
 */
function sqlFindById() {
    return `
        SELECT id, file_path, file_name, file_extension, file_type, file_size, file_hash, video_codec, poster_path, status
        FROM _files
        WHERE id = ? AND status = 1
        LIMIT 1
    `;
}

/**
 * Insere um novo registro de arquivo.
 *
 * Parâmetros: `[file_path, file_name, file_extension, file_type, file_size, file_hash, video_codec, created_by_fk, updated_by_fk]`
 *
 * @returns {string}
 */
function sqlInsertFile() {
    return `
        INSERT INTO _files
            (file_path, file_name, file_extension, file_type, file_size, file_hash, video_codec, created_by_fk, updated_by_fk)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
}

/**
 * Soft-delete: marca o arquivo como inativo (`status = 0`).
 * O registro e o arquivo físico são preservados pois outras entidades
 * podem referenciar o mesmo `file_id`.
 *
 * Parâmetros: `[updated_by_fk, id]`
 *
 * @returns {string}
 */
function sqlSoftDeleteFile() {
    return `UPDATE _files SET status = 0, updated_by_fk = ? WHERE id = ?`;
}

module.exports = {
    sqlFindByHash,
    sqlFindByHashAnyStatus,
    sqlReactivateFile,
    sqlFindById,
    sqlInsertFile,
    sqlSoftDeleteFile,
};
