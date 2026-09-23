/**
 * @fileoverview Adapter MySQL de `miepp_media`.
 *
 * @module modules/global/infrastructure/miepp/mysql-miepp-media.repository
 */

const { MediaRepositoryPort } = require('../../application/miepp/media/ports/media-repository.port');
const { query, execute, count } = require('./miepp-mysql.helper');
const {
    SQL_LIST_MEDIA,
    SQL_COUNT_MEDIA,
    SQL_GET_MEDIA_BY_ID,
    SQL_GET_MEDIA_BY_UUID,
    SQL_GET_DEVICE_MEDIA_BY_ID,
    SQL_INSERT_MEDIA,
    SQL_UPDATE_MEDIA,
    SQL_DELETE_MEDIA,
    SQL_COUNT_MEDIA_USAGE,
} = require('../../repositories/mysql/miepp-media.queries');

class MysqlMieppMediaRepository extends MediaRepositoryPort {
    /**
     * Os filtros vão duplicados porque o SQL usa o padrão `(? IS NULL OR col = ?)`
     * — o mesmo parâmetro é lido duas vezes, e o mysql2 não nomeia placeholder.
     */
    async list({ type, status, origin, limit, offset }) {
        const filters = [
            type ?? null, type ?? null,
            status ?? null, status ?? null,
            origin ?? null, origin ?? null,
        ];
        const [rows, total] = await Promise.all([
            query(SQL_LIST_MEDIA, [...filters, limit, offset]),
            count(SQL_COUNT_MEDIA, filters),
        ]);
        return { rows, total };
    }

    async findById(id) {
        const rows = await query(SQL_GET_MEDIA_BY_ID, [id]);
        return rows[0] || null;
    }

    async findByUuid(uuid) {
        const rows = await query(SQL_GET_MEDIA_BY_UUID, [uuid]);
        return rows[0] || null;
    }

    async findForDevice(id) {
        const rows = await query(SQL_GET_DEVICE_MEDIA_BY_ID, [id]);
        return rows[0] || null;
    }

    async create(payload) {
        const result = await execute(SQL_INSERT_MEDIA, [
            payload.uuid, payload.title, payload.type, payload.file_id, payload.mime_type,
            payload.size_bytes, payload.duration_seconds, payload.checksum,
            payload.status, payload.uploaded_by,
        ]);
        return { id: result.insertId, uuid: payload.uuid };
    }

    async update(id, payload) {
        await execute(SQL_UPDATE_MEDIA, [
            payload.title, payload.duration_seconds, payload.status, id,
        ]);
    }

    async remove(id) {
        await execute(SQL_DELETE_MEDIA, [id]);
    }

    async countPlaylistUsage(id) {
        return count(SQL_COUNT_MEDIA_USAGE, [id]);
    }
}

module.exports = { MysqlMieppMediaRepository };
