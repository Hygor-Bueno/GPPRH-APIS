/**
 * @fileoverview Adapter MySQL de `miepp_locations`.
 *
 * @module modules/global/infrastructure/miepp/mysql-miepp-location.repository
 */

const { LocationRepositoryPort } = require('../../application/miepp/location/ports/location-repository.port');
const { query, execute, count } = require('./miepp-mysql.helper');
const {
    SQL_LIST_LOCATIONS,
    SQL_COUNT_LOCATIONS,
    SQL_GET_LOCATION_BY_ID,
    SQL_INSERT_LOCATION,
    SQL_UPDATE_LOCATION,
    SQL_DELETE_LOCATION,
} = require('../../repositories/mysql/miepp-location.queries');

class MysqlMieppLocationRepository extends LocationRepositoryPort {
    async list({ active, limit, offset }) {
        const [rows, total] = await Promise.all([
            query(SQL_LIST_LOCATIONS, [active, active, limit, offset]),
            count(SQL_COUNT_LOCATIONS, [active, active]),
        ]);
        return { rows, total };
    }

    async findById(id) {
        const rows = await query(SQL_GET_LOCATION_BY_ID, [id]);
        return rows[0] || null;
    }

    async create(payload) {
        const result = await execute(SQL_INSERT_LOCATION, [
            payload.name, payload.address, payload.type, payload.active,
        ]);
        return result.insertId;
    }

    async update(id, payload) {
        await execute(SQL_UPDATE_LOCATION, [
            payload.name, payload.address, payload.type, payload.active, id,
        ]);
    }

    async remove(id) {
        await execute(SQL_DELETE_LOCATION, [id]);
    }
}

module.exports = { MysqlMieppLocationRepository };
