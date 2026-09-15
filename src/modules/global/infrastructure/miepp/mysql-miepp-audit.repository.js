/**
 * @fileoverview Adapter MySQL de `miepp_audit_log`.
 *
 * @module modules/global/infrastructure/miepp/mysql-miepp-audit.repository
 */

const { MieppAuditRepositoryPort } = require('../../application/miepp/ports/miepp-audit-repository.port');
const { query, execute, count, parseJsonColumn } = require('./miepp-mysql.helper');
const { SQL_INSERT_AUDIT, SQL_LIST_AUDIT, SQL_COUNT_AUDIT } = require('../../repositories/mysql/miepp-audit.queries');

class MysqlMieppAuditRepository extends MieppAuditRepositoryPort {
    async record({ userId, action, entityType, entityId, detail }) {
        await execute(SQL_INSERT_AUDIT, [
            userId ?? null,
            action,
            entityType,
            entityId ?? null,
            detail === null || detail === undefined ? null : JSON.stringify(detail),
        ]);
    }

    async list({ entityType, userId, limit, offset }) {
        const filters = [entityType ?? null, entityType ?? null, userId ?? null, userId ?? null];

        const [rows, total] = await Promise.all([
            query(SQL_LIST_AUDIT, [...filters, limit, offset]),
            count(SQL_COUNT_AUDIT, filters),
        ]);

        return {
            rows: rows.map((row) => ({ ...row, detail: parseJsonColumn(row.detail) })),
            total,
        };
    }
}

module.exports = { MysqlMieppAuditRepository };
