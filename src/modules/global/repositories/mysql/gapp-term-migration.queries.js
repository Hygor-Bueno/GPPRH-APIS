/**
 * @fileoverview Consultas SQL puras da migração TEMPORÁRIA de termos do legado
 * (`global.gapp_asset_term_migration` + `_log`).
 *
 * Sem execução, sem I/O. Executadas com `pool.query()` (escape do lado do
 * cliente) por causa do `IN (?)` com array e do `VALUES ?` em lote — continua
 * parametrizado. DDL: `gapp-term-migration-deploy.sql` (nesta pasta).
 *
 * O legado é lido do schema `GIPP` do MESMO servidor MySQL do `global`
 * (`GIPP.gs_smartphone`), pelo `poolGlobal`.
 *
 * @module modules/global/repositories/mysql/gapp-term-migration.queries
 */

const { MIGRATION_STATUS: S, STALE_PROCESSING_MINUTES } = require('../../domain/gapp/term-migration/term-migration.rules');

const TABLE = 'global.gapp_asset_term_migration';
const LOG_TABLE = 'global.gapp_asset_term_migration_log';

const MIGRATION_COLUMNS = `
    m.migration_id, m.source_file_name, m.source_path, m.source_file_size, m.source_modified_at,
    m.legacy_smartphone_code, m.reponsible_name, m.legacy_imei1, m.legacy_imei2, m.imei, m.imei_source,
    m.active_id_fk, m.asset_term_id_fk, m.file_id_fk,
    m.status, m.issue_code, m.message, m.attempts,
    m.created_by, m.updated_by, m.created_at, m.updated_at,
    m.validated_at, m.processing_started_at, m.migrated_at,
    a.brand AS asset_brand, a.model AS asset_model
`;

// O ativo só para exibir marca/modelo — o vínculo é decidido na validação.
const MIGRATION_FROM = `
    FROM ${TABLE} m
    LEFT JOIN global.gapp_active a ON a.active_id = m.active_id_fk
`;

// ─── Varredura ────────────────────────────────────────────────────────────────

/** Quais destes caminhos já estão registrados. Parâmetros: `[[paths]]` */
function sqlFindKnownPaths() {
    return `SELECT source_path FROM ${TABLE} WHERE source_path IN (?)`;
}

/**
 * Registro em lote. Arquivo já conhecido não é tocado (a chave única é o
 * caminho): reexecutar a varredura não duplica nem reabre nada.
 * Parâmetros: `[[[source_file_name, source_path, size, mtime, legacy_code, reponsible_name, status, issue_code, message, created_by, updated_by], ...]]`
 */
function sqlInsertScanned() {
    return `
        INSERT INTO ${TABLE}
            (source_file_name, source_path, source_file_size, source_modified_at,
             legacy_smartphone_code, reponsible_name, status, issue_code, message,
             created_by, updated_by)
        VALUES ?
        ON DUPLICATE KEY UPDATE migration_id = migration_id
    `;
}

/** Ids dos caminhos (para a trilha). Parâmetros: `[[paths]]` */
function sqlFindIdsByPaths() {
    return `SELECT migration_id, status, message FROM ${TABLE} WHERE source_path IN (?)`;
}

// ─── Seleção de lote ─────────────────────────────────────────────────────────

/**
 * Próximas linhas de um conjunto de status, ou as linhas pedidas (`ids`) desde
 * que estejam num desses status. Parâmetros montados aqui.
 */
function sqlSelectBatch({ statuses, ids, limit }) {
    const params = [statuses];
    let idClause = '';
    if (ids) {
        idClause = 'AND m.migration_id IN (?)';
        params.push(ids.length ? ids : [0]);
    }
    params.push(limit);
    return {
        sql: `
            SELECT ${MIGRATION_COLUMNS}
            ${MIGRATION_FROM}
            WHERE m.status IN (?) ${idClause}
            ORDER BY m.migration_id
            LIMIT ?
        `,
        params,
    };
}

/**
 * Elegíveis para "reprocessar": erro, não localizado e linha presa em
 * `processing` há mais de `STALE_PROCESSING_MINUTES` (queda no meio do lote).
 */
function sqlSelectRetryBatch({ ids, limit }) {
    const params = [[S.ERROR, S.NOT_FOUND]];
    let idClause = '';
    if (ids) {
        idClause = 'AND m.migration_id IN (?)';
        params.push(ids.length ? ids : [0]);
    }
    params.push(limit);
    return {
        sql: `
            SELECT ${MIGRATION_COLUMNS}
            ${MIGRATION_FROM}
            WHERE (m.status IN (?)
                   OR (m.status = '${S.PROCESSING}'
                       AND m.processing_started_at < NOW() - INTERVAL ${STALE_PROCESSING_MINUTES} MINUTE))
              ${idClause}
            ORDER BY m.migration_id
            LIMIT ?
        `,
        params,
    };
}

// ─── Legado e base nova ──────────────────────────────────────────────────────

/** Parâmetros: `[[codigos]]` */
function sqlLegacySmartphonesByCodes() {
    return 'SELECT codigo, imei1, imei2 FROM GIPP.gs_smartphone WHERE codigo IN (?)';
}

/**
 * Smartphones da base nova com qualquer um dos IMEIs. Só ativo que existe em
 * `gapp_active` (o vínculo do termo exige). Parâmetros: `[[imeis], [imeis]]`
 */
function sqlSmartphonesByImeis() {
    return `
        SELECT sp.active_id_fk AS active_id, TRIM(sp.imei_1) AS imei_1, TRIM(sp.imei_2) AS imei_2
        FROM global.gapp_smartphone sp
        JOIN global.gapp_active a ON a.active_id = sp.active_id_fk
        WHERE TRIM(sp.imei_1) IN (?) OR TRIM(sp.imei_2) IN (?)
    `;
}

/** O ativo ainda é um smartphone cadastrado? Parâmetros: `[active_id]` */
function sqlIsSmartphoneAsset() {
    return `
        SELECT a.active_id
        FROM global.gapp_active a
        JOIN global.gapp_smartphone sp ON sp.active_id_fk = a.active_id
        WHERE a.active_id = ?
        LIMIT 1
    `;
}

/**
 * Termo que já liga ESTE documento a ESTE ativo — pelo hash do conteúdo em
 * `_files` ou pelo nome do arquivo. É a trava contra duplicar o vínculo quando
 * um lote caiu depois de criar o termo e antes de marcar a linha como migrada.
 * Parâmetros: `[active_id, file_hash, [file_names]]`
 */
function sqlFindExistingTerm() {
    return `
        SELECT t.asset_term_id, t.file_id_fk
        FROM global.gapp_asset_term t
        LEFT JOIN global._files f ON f.id = t.file_id_fk
        WHERE t.active_id_fk = ?
          AND (f.file_hash = ? OR t.file_name IN (?))
        ORDER BY t.asset_term_id
        LIMIT 1
    `;
}

// ─── Transições (todas condicionadas ao status anterior) ─────────────────────
//
// A API roda em cluster de 2 instâncias: duas abas (ou dois cliques) podem
// pegar a mesma linha. Toda mudança de status tem `AND status = ?` e quem
// recebe `affectedRows = 0` desiste daquela linha.

/** Parâmetros: ver `buildValidationParams`. */
function sqlApplyValidation() {
    return `
        UPDATE ${TABLE}
        SET status = ?, issue_code = ?, message = ?,
            legacy_smartphone_code = ?, reponsible_name = ?,
            legacy_imei1 = ?, legacy_imei2 = ?, imei = ?, imei_source = ?,
            active_id_fk = ?, validated_at = NOW(), updated_by = ?
        WHERE migration_id = ? AND status = ?
    `;
}

function buildValidationParams(result, { migrationId, expectedStatus, userId }) {
    return [
        result.status, result.issue_code ?? null, result.message ?? null,
        result.legacy_smartphone_code ?? null, result.reponsible_name ?? null,
        result.legacy_imei1 ?? null, result.legacy_imei2 ?? null,
        result.imei ?? null, result.imei_source ?? null,
        result.active_id_fk ?? null, userId,
        migrationId, expectedStatus,
    ];
}

/** Reserva a linha para migrar. Parâmetros: `[updated_by, migration_id]` */
function sqlClaimForMigration() {
    return `
        UPDATE ${TABLE}
        SET status = '${S.PROCESSING}', processing_started_at = NOW(), attempts = attempts + 1, updated_by = ?
        WHERE migration_id = ? AND status = '${S.VALIDATED}'
    `;
}

/** Parâmetros: `[asset_term_id_fk, file_id_fk, message, updated_by, migration_id]` */
function sqlMarkMigrated() {
    return `
        UPDATE ${TABLE}
        SET status = '${S.MIGRATED}', asset_term_id_fk = ?, file_id_fk = ?,
            issue_code = NULL, message = ?, migrated_at = NOW(), updated_by = ?
        WHERE migration_id = ? AND status = '${S.PROCESSING}'
    `;
}

/** Parâmetros: `[status, issue_code, message, updated_by, migration_id]` */
function sqlMarkFailed() {
    return `
        UPDATE ${TABLE}
        SET status = ?, issue_code = ?, message = ?, updated_by = ?
        WHERE migration_id = ? AND status = '${S.PROCESSING}'
    `;
}

/**
 * Devolve para a fila (reprocessar). Limpa o resultado da validação anterior:
 * nada do vínculo antigo é reaproveitado sem validar de novo.
 * Parâmetros: `[updated_by, migration_id, expected_status]`
 */
function sqlResetToPending() {
    return `
        UPDATE ${TABLE}
        SET status = '${S.PENDING}', issue_code = NULL, message = NULL,
            imei = NULL, imei_source = NULL, active_id_fk = NULL, validated_at = NULL,
            processing_started_at = NULL, updated_by = ?
        WHERE migration_id = ? AND status = ?
    `;
}

/** Parâmetros: `[message, updated_by, migration_id]` */
function sqlIgnore() {
    return `
        UPDATE ${TABLE}
        SET status = '${S.IGNORED}', message = ?, updated_by = ?
        WHERE migration_id = ? AND status IN ('${S.PENDING}', '${S.VALIDATED}', '${S.ERROR}', '${S.NOT_FOUND}')
    `;
}

/** Parâmetros: `[updated_by, migration_id]` */
function sqlRestore() {
    return `
        UPDATE ${TABLE}
        SET status = '${S.PENDING}', issue_code = NULL, message = NULL,
            imei = NULL, imei_source = NULL, active_id_fk = NULL, validated_at = NULL, updated_by = ?
        WHERE migration_id = ? AND status = '${S.IGNORED}'
    `;
}

// ─── Consulta ────────────────────────────────────────────────────────────────

function sqlSummaryByStatus() {
    return `SELECT status, COUNT(*) AS total FROM ${TABLE} GROUP BY status`;
}

function sqlSummaryByIssue() {
    return `
        SELECT issue_code, COUNT(*) AS total
        FROM ${TABLE}
        WHERE issue_code IS NOT NULL AND status IN ('${S.ERROR}', '${S.NOT_FOUND}')
        GROUP BY issue_code
    `;
}

/** Filtros da listagem → WHERE. `search` procura em nome, IMEI e código antigo. */
function buildListFilters(filters = {}) {
    const conditions = [];
    const params = [];

    if (filters.status) {
        conditions.push('m.status = ?');
        params.push(filters.status);
    }
    if (filters.issue_code) {
        conditions.push('m.issue_code = ?');
        params.push(filters.issue_code);
    }
    if (filters.active_id_fk) {
        conditions.push('m.active_id_fk = ?');
        params.push(filters.active_id_fk);
    }
    const search = String(filters.search ?? '').trim();
    if (search) {
        const like = `%${search}%`;
        conditions.push(`(m.source_file_name LIKE ? OR m.imei LIKE ? OR m.legacy_imei1 LIKE ?
                          OR m.legacy_imei2 LIKE ? OR CAST(m.legacy_smartphone_code AS CHAR) = ?)`);
        params.push(like, like, like, like, search);
    }

    return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

function sqlListMigrations(filters, { limit, offset }) {
    const { where, params } = buildListFilters(filters);
    return {
        sql: `
            SELECT ${MIGRATION_COLUMNS}
            ${MIGRATION_FROM}
            ${where}
            ORDER BY m.migration_id
            LIMIT ? OFFSET ?
        `,
        params: [...params, limit, offset],
    };
}

function sqlCountMigrations(filters) {
    const { where, params } = buildListFilters(filters);
    return { sql: `SELECT COUNT(*) AS total ${MIGRATION_FROM} ${where}`, params };
}

/** Parâmetros: `[migration_id]` */
function sqlGetMigrationById() {
    return `SELECT ${MIGRATION_COLUMNS} ${MIGRATION_FROM} WHERE m.migration_id = ?`;
}

/** Parâmetros: `[migration_id]` */
function sqlListLogs() {
    return `
        SELECT log_id, action, from_status, to_status, message, created_by, created_at
        FROM ${LOG_TABLE}
        WHERE migration_id_fk = ?
        ORDER BY log_id
    `;
}

/** Parâmetros: `[[[migration_id_fk, action, from_status, to_status, message, created_by], ...]]` */
function sqlInsertLogs() {
    return `
        INSERT INTO ${LOG_TABLE} (migration_id_fk, action, from_status, to_status, message, created_by)
        VALUES ?
    `;
}

module.exports = {
    sqlFindKnownPaths, sqlInsertScanned, sqlFindIdsByPaths,
    sqlSelectBatch, sqlSelectRetryBatch,
    sqlLegacySmartphonesByCodes, sqlSmartphonesByImeis, sqlIsSmartphoneAsset, sqlFindExistingTerm,
    sqlApplyValidation, buildValidationParams,
    sqlClaimForMigration, sqlMarkMigrated, sqlMarkFailed, sqlResetToPending, sqlIgnore, sqlRestore,
    sqlSummaryByStatus, sqlSummaryByIssue,
    sqlListMigrations, sqlCountMigrations, sqlGetMigrationById,
    sqlListLogs, sqlInsertLogs,
};
