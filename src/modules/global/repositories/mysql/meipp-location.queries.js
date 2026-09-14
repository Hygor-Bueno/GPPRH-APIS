/**
 * @fileoverview Consultas SQL puras para `meipp_locations`.
 *
 * @module modules/global/repositories/mysql/meipp-location.queries
 */

const COLUMNS = `id, name, address, type, active, created_at, updated_at`;

const SQL_LIST_LOCATIONS = `
    SELECT ${COLUMNS}
    FROM meipp_locations
    WHERE (? IS NULL OR active = ?)
    ORDER BY name
    LIMIT ? OFFSET ?
`;

const SQL_COUNT_LOCATIONS = `
    SELECT COUNT(*) AS total
    FROM meipp_locations
    WHERE (? IS NULL OR active = ?)
`;

const SQL_GET_LOCATION_BY_ID = `
    SELECT ${COLUMNS} FROM meipp_locations WHERE id = ?
`;

const SQL_INSERT_LOCATION = `
    INSERT INTO meipp_locations (name, address, type, active)
    VALUES (?, ?, ?, ?)
`;

const SQL_UPDATE_LOCATION = `
    UPDATE meipp_locations
    SET name = ?, address = ?, type = ?, active = ?
    WHERE id = ?
`;

/**
 * Exclusão física. Os players que apontavam para o local ficam com
 * `location_id = NULL` (ON DELETE SET NULL no schema), não somem junto.
 */
const SQL_DELETE_LOCATION = `
    DELETE FROM meipp_locations WHERE id = ?
`;

module.exports = {
    SQL_LIST_LOCATIONS,
    SQL_COUNT_LOCATIONS,
    SQL_GET_LOCATION_BY_ID,
    SQL_INSERT_LOCATION,
    SQL_UPDATE_LOCATION,
    SQL_DELETE_LOCATION,
};
