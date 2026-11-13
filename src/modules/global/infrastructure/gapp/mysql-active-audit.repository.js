/**
 * @fileoverview Adapter MySQL — implementa `ActiveAuditRepositoryPort`.
 *
 * `runLocked` abre a transação, trava a auditoria com `SELECT ... FOR UPDATE`
 * e entrega à função um `tx` com as operações ligadas à MESMA conexão.
 * COMMIT no fim; qualquer erro → ROLLBACK.
 *
 * @module modules/global/infrastructure/gapp/mysql-active-audit.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { ActiveAuditRepositoryPort } = require('../../application/gapp/active-audit/ports/active-audit-repository.port');
const {
    sqlListActivesForSnapshot, sqlInsertAudit,
    sqlListAudits, sqlCountAudits, sqlGetAuditById, sqlListAuditItems,
    sqlIdentifierHistory, sqlLockAudit, sqlGetAuditItem, sqlFindItemByIdentifier,
    sqlInsertAuditItem, buildInsertAuditItemParams,
    sqlUpdateAuditItem, buildUpdateAuditItemParams,
    sqlUpdateAuditStatus, sqlCloseAudit,
} = require('../../repositories/mysql/gapp-active-audit.queries');

/** O mysql2 já devolve coluna JSON como objeto; o parse cobre driver/config que devolva texto. */
function parseJson(value) {
    if (value == null || typeof value !== 'string') return value ?? null;
    try { return JSON.parse(value); } catch { return value; }
}

const parseAudit = row => row && ({
    ...row,
    initial_data: parseJson(row.initial_data),
    ...(Object.prototype.hasOwnProperty.call(row, 'final_data') ? { final_data: parseJson(row.final_data) } : {}),
});

const parseItem = row => row && { ...row, additional_items: parseJson(row.additional_items) };

function toAppError(error) {
    if (error instanceof AppError) return error;
    if (error?.code === 'ER_DUP_ENTRY') {
        return new AppError('Este ativo já foi conferido nesta auditoria.', 409, { code: 'GAPP_AUDIT_ITEM_DUPLICATED' });
    }
    return new AppError(error?.message || 'Erro ao acessar o banco de dados.', 500, {
        code: 'GAPP_ACTIVE_AUDIT_MYSQL_ERROR',
        details: error,
    });
}

/** Consultas de histórico de identificador — usadas dentro e fora da transação. */
async function queryIdentifierHistory(runner, auditId, pairs) {
    if (!pairs.length) return [];
    const { sql, build } = sqlIdentifierHistory(pairs);
    const [rows] = await runner.query(sql, build(auditId));
    return rows;
}

class MysqlActiveAuditRepository extends ActiveAuditRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.query(sql, params);
        } catch (error) {
            throw toAppError(error);
        }
    }

    async findActivesForSnapshot(activeIds, workGroupFk) {
        if (!activeIds.length) return [];
        const [rows] = await this._query(sqlListActivesForSnapshot(), [workGroupFk, activeIds]);
        return rows;
    }

    async createAudit(data) {
        const [result] = await this._query(sqlInsertAudit(), [
            data.user_open_id_fk,
            JSON.stringify(data.initial_data),
            data.quantity_active,
        ]);
        return { insertId: result.insertId };
    }

    async list(filters) {
        const { sql, params } = sqlListAudits(filters);
        const { sql: countSql, params: countParams } = sqlCountAudits(filters);
        const [rows] = await this._query(sql, params);
        const [[{ total }]] = await this._query(countSql, countParams);
        return { items: rows, total, page: Number(filters.page) || 1, limit: Number(filters.limit) || 20 };
    }

    async findById(auditId, workGroupFk) {
        const [rows] = await this._query(sqlGetAuditById(), [auditId, workGroupFk]);
        return parseAudit(rows[0]) ?? null;
    }

    async listItems(auditId) {
        const [rows] = await this._query(sqlListAuditItems(), [auditId]);
        return rows.map(parseItem);
    }

    async findIdentifierHistory(auditId, pairs) {
        try {
            return await queryIdentifierHistory(poolGlobal, auditId, pairs);
        } catch (error) {
            throw toAppError(error);
        }
    }

    async runLocked(auditId, fn) {
        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();

            const [[locked]] = await conn.query(sqlLockAudit(), [auditId]);
            const tx = this._bindTransaction(conn, auditId, parseAudit(locked) ?? null);

            const result = await fn(tx);
            await conn.commit();
            return result;
        } catch (error) {
            try { await conn.rollback(); } catch { /* conexão já perdida */ }
            throw toAppError(error);
        } finally {
            conn.release();
        }
    }

    /** @private */
    _bindTransaction(conn, auditId, audit) {
        return {
            audit,

            async findItem(activeId) {
                const [rows] = await conn.query(sqlGetAuditItem(), [auditId, activeId]);
                return parseItem(rows[0]) ?? null;
            },

            async findItemByIdentifier(type, value, ignoreActiveId) {
                const [rows] = await conn.query(sqlFindItemByIdentifier(), [auditId, type, value, ignoreActiveId]);
                return rows[0] ?? null;
            },

            async insertItem(data) {
                const [result] = await conn.query(sqlInsertAuditItem(), buildInsertAuditItemParams(auditId, data));
                return { insertId: result.insertId };
            },

            async updateItem(data) {
                const [result] = await conn.query(sqlUpdateAuditItem(), buildUpdateAuditItemParams(auditId, data));
                return { updated: result.affectedRows };
            },

            async updateStatus(from, to) {
                const [result] = await conn.query(sqlUpdateAuditStatus(), [to, auditId, from]);
                return { updated: result.affectedRows };
            },

            async listItems() {
                const [rows] = await conn.query(sqlListAuditItems(), [auditId]);
                return rows.map(parseItem);
            },

            findIdentifierHistory(pairs) {
                return queryIdentifierHistory(conn, auditId, pairs);
            },

            async closeAudit({ finalData, userId, status }) {
                const [result] = await conn.query(sqlCloseAudit(), [JSON.stringify(finalData), userId, status, auditId]);
                return { updated: result.affectedRows };
            },
        };
    }
}

module.exports = { MysqlActiveAuditRepository };
