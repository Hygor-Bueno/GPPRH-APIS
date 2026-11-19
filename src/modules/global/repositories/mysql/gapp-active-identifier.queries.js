/**
 * @fileoverview Consultas SQL puras dos identificadores do ativo
 * (`gapp_active_identifiers`: patrimônio e número de série). Sem I/O.
 *
 * @module modules/global/repositories/mysql/gapp-active-identifier.queries
 */

const IDENTIFIER_COLUMNS = 'identifier_id, active_id_fk, identifier_type, identifier_value, is_primary, created_at';

/** Ativo do grupo de trabalho do usuário. Params: [active_id, work_group_fk] */
function sqlActiveInGroup() {
    return 'SELECT active_id FROM global.gapp_active WHERE active_id = ? AND work_group_fk = ?';
}

/** Identificadores do ativo, o principal primeiro. Params: [active_id] */
function sqlListByActive() {
    return `
        SELECT ${IDENTIFIER_COLUMNS}
        FROM global.gapp_active_identifiers
        WHERE active_id_fk = ?
        ORDER BY is_primary DESC, created_at, identifier_id
    `;
}

/** Um identificador do ativo. Params: [identifier_id, active_id] */
function sqlGetById() {
    return `SELECT ${IDENTIFIER_COLUMNS} FROM global.gapp_active_identifiers WHERE identifier_id = ? AND active_id_fk = ?`;
}

/**
 * Dono do mesmo tipo + valor (um identificador pertence a um único ativo).
 * A collation da coluna já ignora caixa; o valor chega sem espaços nas pontas.
 * Params: [identifier_type, identifier_value]
 */
function sqlFindByValue() {
    return `
        SELECT identifier_id, active_id_fk
        FROM global.gapp_active_identifiers
        WHERE identifier_type = ? AND identifier_value = ?
        LIMIT 1
    `;
}

/** Params: [active_id, identifier_type, identifier_value] — nasce como não principal. */
function sqlInsert() {
    return `
        INSERT INTO global.gapp_active_identifiers (active_id_fk, identifier_type, identifier_value, is_primary, created_at)
        VALUES (?, ?, ?, 0, NOW())
    `;
}

/** Um único principal por ativo, numa instrução só. Params: [identifier_id, active_id] */
function sqlSetPrimary() {
    return 'UPDATE global.gapp_active_identifiers SET is_primary = (identifier_id = ?) WHERE active_id_fk = ?';
}

/** Params: [identifier_id, active_id] */
function sqlDelete() {
    return 'DELETE FROM global.gapp_active_identifiers WHERE identifier_id = ? AND active_id_fk = ?';
}

module.exports = {
    sqlActiveInGroup,
    sqlListByActive,
    sqlGetById,
    sqlFindByValue,
    sqlInsert,
    sqlSetPrimary,
    sqlDelete,
};
