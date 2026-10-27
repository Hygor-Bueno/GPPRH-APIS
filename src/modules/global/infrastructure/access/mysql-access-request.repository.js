/**
 * @fileoverview Adapter MySQL — implementa `AccessRequestRepositoryPort`.
 *
 * `pool.query()` e não `execute()`: `LIMIT ? OFFSET ?` com prepared statement
 * do mysql2 dá "Incorrect arguments to mysqld_stmt_execute". Continua
 * parametrizado (escape do lado do cliente).
 *
 * @module modules/global/infrastructure/access/mysql-access-request.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { AccessErrorCode } = require('../../domain/access/access-request.enums');
const { AccessRequestRepositoryPort } = require('../../application/access/ports/access-request-repository.port');
const {
    sqlListRequests,
    sqlCountRequests,
    sqlGetRequestById,
    sqlInsertRequest,
    sqlClaimRequest,
    sqlReleaseRequest,
    sqlSetRequestTargetUser,
    sqlFindUserIdByUsername,
    sqlFindPendingCreateUser,
    sqlCountPendingByType,
    sqlFindApproverIds,
} = require('../../repositories/mysql/access-request.queries');

class MysqlAccessRequestRepository extends AccessRequestRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            const [result] = await poolGlobal.query(sql, params);
            return result;
        } catch (error) {
            throw new AppError('Erro ao acessar o banco de dados', 500, {
                code: AccessErrorCode.MysqlError,
                details: error,
            });
        }
    }

    async findRequests(filters, { limit, offset }) {
        const where = [
            filters.status, filters.status,
            filters.type, filters.type,
            filters.requestedBy, filters.requestedBy,
            filters.targetUserId, filters.targetUserId,
        ];
        const [rows, [count]] = await Promise.all([
            this._query(sqlListRequests(), [...where, limit, offset]),
            this._query(sqlCountRequests(), where),
        ]);
        return { rows, total: count.total };
    }

    async findRequestById(id) {
        const rows = await this._query(sqlGetRequestById(), [id]);
        return rows[0] ?? null;
    }

    async insertRequest(data) {
        const result = await this._query(sqlInsertRequest(), [
            data.type,
            data.targetUserId ?? null,
            data.targetRoleId ?? null,
            data.targetPermissionId ?? null,
            JSON.stringify(data.payload ?? {}),
            data.requestedBy,
        ]);
        return result.insertId;
    }

    async claimRequest(id, status, reviewedBy, note) {
        const result = await this._query(sqlClaimRequest(), [status, reviewedBy, note ?? null, id]);
        return result.affectedRows === 1;
    }

    async releaseRequest(id) {
        await this._query(sqlReleaseRequest(), [id]);
    }

    async setTargetUser(id, userId) {
        await this._query(sqlSetRequestTargetUser(), [userId, id]);
    }

    async usernameExists(username) {
        const rows = await this._query(sqlFindUserIdByUsername(), [username]);
        return rows.length > 0;
    }

    async hasPendingCreateUser(username) {
        const rows = await this._query(sqlFindPendingCreateUser(), [username]);
        return rows.length > 0;
    }

    async countPendingByType() {
        const rows = await this._query(sqlCountPendingByType());
        return Object.fromEntries(rows.map(r => [r.type, Number(r.total)]));
    }

    async findApproverIds() {
        const rows = await this._query(sqlFindApproverIds());
        return rows.map(r => Number(r.id));
    }
}

module.exports = { MysqlAccessRequestRepository };
