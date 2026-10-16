/**
 * @fileoverview Adapters MySQL dos relógios (`cppp_devices`) e das coletas
 * (`cppp_collect_runs`).
 *
 * Num arquivo só porque as duas tabelas são lidas juntas em quase toda
 * consulta (coleta sempre traz o relógio) e compartilham o mesmo `.queries`.
 *
 * @module modules/global/infrastructure/cppp/mysql-cppp-collect.repository
 */

const { CpppCollectRunRepositoryPort } = require('../../application/cppp/ports/cppp-collect-run-repository.port');
const { CpppDeviceRepositoryPort } = require('../../application/cppp/ports/cppp-device-repository.port');
const { query, execute, count, isDuplicate } = require('./cppp-mysql.helper');
const { AppError } = require('../../../../errors/app.error');
const Q = require('../../repositories/mysql/cppp-collect.queries');

const first = (rows) => rows[0] ?? null;

/**
 * Qual chave única o MySQL acusou, para o 409 dizer o campo certo.
 * O nome da chave vem na mensagem do ER_DUP_ENTRY.
 */
function duplicateDeviceMessage(error) {
    const message = String(error?.details?.sqlMessage ?? error?.details?.message ?? '');
    if (message.includes('uq_cppp_devices_code')) return 'Já existe relógio com este código.';
    if (message.includes('uq_cppp_devices_base_url')) return 'Este IP já está cadastrado em outro relógio.';
    if (message.includes('uq_cppp_devices_rep')) return 'Este número de REP já está cadastrado em outro relógio.';
    return 'Já existe relógio com estes dados.';
}

function rethrowDuplicate(error) {
    if (isDuplicate(error)) throw new AppError(duplicateDeviceMessage(error), 409, { code: 'CPPP_DEVICE_DUPLICATE' });
    throw error;
}

class MysqlCpppDeviceRepository extends CpppDeviceRepositoryPort {
    async listActive() {
        return query(Q.SQL_LIST_ACTIVE_DEVICES);
    }

    async findById(id) {
        return first(await query(Q.SQL_FIND_DEVICE, [id]));
    }

    async findByRepNumber(repNumber) {
        return first(await query(Q.SQL_FIND_DEVICE_BY_REP, [repNumber]));
    }

    async listWithLastRun() {
        return query(Q.SQL_LIST_DEVICES_WITH_LAST_RUN);
    }

    async insert({ code, name, baseUrl, repNumber = null, active = true }, userId) {
        try {
            const result = await execute(Q.SQL_INSERT_DEVICE, [code, name, baseUrl, repNumber, active ? 1 : 0, userId, userId]);
            return result.insertId;
        } catch (error) {
            return rethrowDuplicate(error);
        }
    }

    async update(id, fields, userId) {
        const keys = Object.keys(fields).filter((key) => key in Q.DEVICE_UPDATABLE);
        const values = keys.map((key) => (key === 'active' ? (fields[key] ? 1 : 0) : fields[key]));
        try {
            await execute(Q.sqlUpdateDevice(keys), [...values, userId, id]);
        } catch (error) {
            rethrowDuplicate(error);
        }
    }

    async hasRecords(id) {
        return Number(first(await query(Q.SQL_DEVICE_HAS_RECORDS, [id]))?.has_records ?? 0) === 1;
    }

    async setRepNumberIfEmpty(id, repNumber) {
        await execute(Q.SQL_SET_REP_IF_EMPTY, [repNumber, id]);
    }
}

class MysqlCpppCollectRunRepository extends CpppCollectRunRepositoryPort {
    async enqueue({ deviceId, trigger, requestedBy }) {
        try {
            const result = await execute(Q.SQL_ENQUEUE_RUN, [deviceId, trigger, requestedBy ?? null]);
            return result.insertId;
        } catch (error) {
            // `uq_cppp_runs_active`: o relógio já tem coleta viva. É o banco
            // que garante — duas instâncias do cluster recebendo o mesmo
            // clique não conseguem enfileirar duas.
            if (isDuplicate(error)) return null;
            throw error;
        }
    }

    async findById(id) {
        return first(await query(Q.SQL_FIND_RUN, [id]));
    }

    async findActive(deviceId) {
        return first(await query(Q.SQL_FIND_ACTIVE_RUN, [deviceId]));
    }

    async list({ deviceId = null, status = null, limit, offset }) {
        const filters = [deviceId, deviceId, status, status];
        const [rows, total] = await Promise.all([
            query(Q.SQL_LIST_RUNS, [...filters, limit, offset]),
            count(Q.SQL_COUNT_RUNS, filters),
        ]);
        return { rows, total };
    }

    async nextQueued() {
        return first(await query(Q.SQL_NEXT_QUEUED_RUN));
    }

    async claim(id) {
        const result = await execute(Q.SQL_CLAIM_RUN, [id]);
        return result.affectedRows === 1;
    }

    async setRequestedFrom(id, requestedFrom) {
        await execute(Q.SQL_SET_REQUESTED_FROM, [requestedFrom, id]);
    }

    async finish(id, r) {
        await execute(Q.SQL_FINISH_RUN, [
            r.status,
            r.extracted ?? 0,
            r.inserted ?? 0,
            r.identical ?? 0,
            r.rejected ?? 0,
            r.conflicts ?? 0,
            r.firstNsr ?? null,
            r.lastNsr ?? null,
            r.trailerCheck ?? null,
            r.rawFilePath ?? null,
            r.rawSha256 ?? null,
            r.rawBytes ?? null,
            r.error ? String(r.error).slice(0, 60000) : null,
            r.warnings ? String(r.warnings).slice(0, 60000) : null,
            id,
        ]);
    }

    async failStuck(minutes) {
        const result = await execute(Q.SQL_FAIL_STUCK_RUNS, [minutes]);
        return result.affectedRows;
    }

    async lastScheduledAt(deviceId) {
        return first(await query(Q.SQL_LAST_SCHEDULED_AT, [deviceId]))?.at ?? null;
    }

    async lastSuccessByDevice() {
        const rows = await query(Q.SQL_LAST_SUCCESS_BY_DEVICE);
        return rows.map((row) => ({ deviceId: Number(row.device_id), lastSuccessAt: row.last_success_at }));
    }
}

module.exports = { MysqlCpppDeviceRepository, MysqlCpppCollectRunRepository };
