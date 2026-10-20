/**
 * @fileoverview Adapter MySQL do espelho do relógio (`cppp_afd_records`).
 *
 * @module modules/global/infrastructure/cppp/mysql-cppp-afd.repository
 */

const { CpppAfdRepositoryPort } = require('../../application/cppp/ports/cppp-afd-repository.port');
const { query, count, transaction } = require('./cppp-mysql.helper');
const Q = require('../../repositories/mysql/cppp-afd.queries');

/**
 * Linhas por INSERT. 1.000 linhas de ~120 bytes ficam longe do
 * `max_allowed_packet` e do timeout de 15s por query do `config/mysql`; o AFD
 * integral (~44 mil linhas) vira ~45 INSERTs numa transação só.
 */
const INSERT_CHUNK = 1000;

class MysqlCpppAfdRepository extends CpppAfdRepositoryPort {
    async lastContiguousNsr(deviceId) {
        const rows = await query(Q.SQL_LAST_CONTIGUOUS_NSR, [deviceId]);
        return rows.length ? Number(rows[0].nsr) : null;
    }

    async findRawLines(deviceId, minNsr, maxNsr) {
        const rows = await query(Q.SQL_FIND_RAW_LINES, [deviceId, minNsr, maxNsr]);
        return new Map(rows.map((row) => [Number(row.nsr), row.raw_line]));
    }

    /**
     * Tudo ou nada: uma coleta não deixa metade do lote gravada. Se a
     * transação cair, a coleta termina `failed` e a próxima pede de novo do
     * mesmo ponto.
     */
    async insertRecords(deviceId, runId, records) {
        return transaction(async (conn) => {
            let inserted = 0;
            for (let i = 0; i < records.length; i += INSERT_CHUNK) {
                const values = records.slice(i, i + INSERT_CHUNK).map((r) => [
                    deviceId, r.nsr, r.recordType, r.occurredAt, r.utcOffset, r.cpf, r.operation,
                    r.eventCode, r.employeeName, r.crc, r.payload, r.rawLine, runId,
                ]);
                const [result] = await conn.query(Q.SQL_INSERT_RECORDS, [values]);
                inserted += result.affectedRows;
            }
            return inserted;
        });
    }

    async findPunches({ from, to, cpf = null }) {
        const rows = await query(Q.SQL_FIND_PUNCHES, [from, to, cpf, cpf]);
        return rows.map((row) => ({
            deviceId: Number(row.device_id),
            nsr: Number(row.nsr),
            cpf: row.cpf,
            day: row.day,
            time: row.time,
        }));
    }

    async findDayPunches(cpf, day) {
        return query(Q.SQL_FIND_DAY_PUNCHES, [cpf, day, day]);
    }

    async findRecord(deviceId, nsr) {
        const rows = await query(Q.SQL_FIND_RECORD, [deviceId, nsr]);
        if (!rows.length) return null;
        const row = rows[0];
        return {
            deviceId: Number(row.device_id),
            nsr: Number(row.nsr),
            recordType: Number(row.record_type),
            cpf: row.cpf,
            day: row.day,
        };
    }

    async listPunches({ from, to, cpf = null, deviceId = null, limit, offset }) {
        const filters = [from, to, cpf, cpf, deviceId, deviceId];
        const [rows, total] = await Promise.all([
            query(Q.SQL_LIST_PUNCHES, [...filters, limit, offset]),
            count(Q.SQL_COUNT_PUNCHES, filters),
        ]);
        return { rows, total };
    }

    async listEmployees({ search = null, onlyWithPunches = true, limit, offset }) {
        const like = search ? `%${search}%` : null;
        const filters = [onlyWithPunches ? 1 : 0, search, like, like];
        const [rows, total] = await Promise.all([
            query(Q.SQL_LIST_EMPLOYEES, [...filters, limit, offset]),
            count(Q.SQL_COUNT_EMPLOYEES, filters),
        ]);
        return { rows: rows.map((row) => ({ ...row, punches: Number(row.punches) })), total };
    }

    async clockNames(cpfs) {
        if (!cpfs.length) return new Map();
        const rows = await query(Q.SQL_CLOCK_NAMES, [cpfs]);
        return new Map(rows.map((row) => [row.cpf, { name: row.employee_name, operation: row.operation }]));
    }
}

module.exports = { MysqlCpppAfdRepository, INSERT_CHUNK };
