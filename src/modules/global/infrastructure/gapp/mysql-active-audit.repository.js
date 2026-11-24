/**
 * @fileoverview Adapter MySQL — implementa `ActiveAuditRepositoryPort`.
 *
 * `runLocked` abre a transação, trava a auditoria com `SELECT ... FOR UPDATE`
 * e entrega à função um `tx` com as operações ligadas à MESMA conexão.
 * COMMIT no fim; qualquer erro → ROLLBACK. É isso que torna a finalização
 * segura: gravar final_data → reler e conferir → limpar a temporária
 * acontecem juntos ou não acontecem.
 *
 * @module modules/global/infrastructure/gapp/mysql-active-audit.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { ActiveAuditRepositoryPort } = require('../../application/gapp/active-audit/ports/active-audit-repository.port');
const {
    sqlListActivesForAudit, sqlFindUnit, sqlFindDepartment, sqlFindActiveClass, sqlFindActiveType,
    sqlInsertAudit, buildInsertAuditParams, sqlInsertAuditScope, buildAuditScopeRows, sqlListAuditScopes,
    sqlListAudits, sqlCountAudits, sqlGetAuditById, sqlListAuditItems, sqlListUserNames,
    sqlIdentifierHistory, sqlLockAudit, sqlGetAuditItem, sqlGetActiveLocation, sqlFindItemByIdentifier, buildFindItemByIdentifierParams,
    sqlInsertAuditItem, buildInsertAuditItemParams,
    sqlUpdateAuditItem, buildUpdateAuditItemParams,
    sqlUpdateAuditStatus, sqlCloseAudit, sqlGetFinalData, sqlDeleteAuditItems, sqlUpdateInitialData,
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

/** Primeira linha de uma consulta por id, ou `null` (id vazio não consulta). */
async function findOne(runner, sql, id) {
    if (id == null) return null;
    const [rows] = await runner.query(sql, [id]);
    return rows[0] ?? null;
}

/** Unidade, setor, classe e tipo — o que vier preenchido. Usado na abertura e no destino da transferência. */
async function queryRefs(runner, { unit_id_fk, dep_id_fk, id_active_class_fk, active_type_id_fk } = {}) {
    const [unit, department, activeClass, activeType] = await Promise.all([
        findOne(runner, sqlFindUnit(), unit_id_fk),
        findOne(runner, sqlFindDepartment(), dep_id_fk),
        findOne(runner, sqlFindActiveClass(), id_active_class_fk),
        findOne(runner, sqlFindActiveType(), active_type_id_fk),
    ]);
    return { unit, department, activeClass, activeType };
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

    async findActivesForAudit({ scope, workGroupFk, activeIds = null, limit }) {
        const { sql, params } = sqlListActivesForAudit(scope, workGroupFk, activeIds, limit);
        const [rows] = await this._query(sql, params);
        return rows;
    }

    async findRefs(refs) {
        try {
            return await queryRefs(poolGlobal, refs);
        } catch (error) {
            throw toAppError(error);
        }
    }

    /** Cabeçalho e lojas do escopo na mesma transação: não existe auditoria sem escopo. */
    createAudit({ audit, scope }) {
        return this._inTransaction(async conn => {
            const [result] = await conn.query(sqlInsertAudit(), buildInsertAuditParams(audit));
            await conn.query(sqlInsertAuditScope(), [buildAuditScopeRows(result.insertId, scope)]);
            return { insertId: result.insertId };
        });
    }

    /** Lojas (códigos do Protheus) das auditorias informadas. */
    async findScopes(auditIds) {
        if (!auditIds.length) return [];
        const [rows] = await this._query(sqlListAuditScopes(), [auditIds]);
        return rows;
    }

    async findUserNames(userIds) {
        if (!userIds.length) return [];
        const [rows] = await this._query(sqlListUserNames(), [userIds]);
        return rows;
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

    runLocked(auditId, fn) {
        return this._inTransaction(async conn => {
            const [[locked]] = await conn.query(sqlLockAudit(), [auditId]);
            return fn(this._bindTransaction(conn, auditId, parseAudit(locked) ?? null));
        });
    }

    /** @private Transação numa conexão própria: COMMIT no fim, ROLLBACK em qualquer erro. */
    async _inTransaction(fn) {
        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();
            const result = await fn(conn);
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

            async findActiveLocation(activeId) {
                return findOne(conn, sqlGetActiveLocation(), activeId);
            },

            findRefs(refs) {
                return queryRefs(conn, refs);
            },

            async findItemByIdentifier(type, value, ignoreActiveId) {
                const params = buildFindItemByIdentifierParams(auditId, type, value, ignoreActiveId);
                const [rows] = await conn.query(sqlFindItemByIdentifier(), params);
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

            async updateInitialData(initialData) {
                const params = [JSON.stringify(initialData), initialData.assets.length, auditId];
                const [result] = await conn.query(sqlUpdateInitialData(), params);
                return { updated: result.affectedRows };
            },

            async getFinalData() {
                const [rows] = await conn.query(sqlGetFinalData(), [auditId]);
                return rows[0] ? parseJson(rows[0].final_data) : null;
            },

            async deleteItems() {
                const [result] = await conn.query(sqlDeleteAuditItems(), [auditId]);
                return { deleted: result.affectedRows };
            },
        };
    }
}

module.exports = { MysqlActiveAuditRepository };
