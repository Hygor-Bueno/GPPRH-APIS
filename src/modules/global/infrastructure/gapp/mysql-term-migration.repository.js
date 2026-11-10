/**
 * @fileoverview Adapter MySQL — implementa `TermMigrationRepositoryPort`
 * (migração TEMPORÁRIA de termos do legado).
 *
 * `pool.query()` e não `execute()`: `IN (?)` com array e `VALUES ?` em lote só
 * funcionam com o escape do lado do cliente (continua parametrizado). Erro cru
 * do MySQL não chega ao cliente — vira `GAPP_TERM_MIGRATION_MYSQL_ERROR`.
 *
 * @module modules/global/infrastructure/gapp/mysql-term-migration.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { TermMigrationRepositoryPort } = require('../../application/gapp/term-migration/ports/term-migration.ports');
const q = require('../../repositories/mysql/gapp-term-migration.queries');

const CHUNK = 500;

/** Motivo legível do MySQL — a tela é só de `SYSTEM_OWNER` e sem isso não há como diagnosticar. */
function describeMysqlError(error) {
    const code = error?.code ? `${error.code}: ` : '';
    return `${code}${error?.sqlMessage || error?.message || 'erro desconhecido'}`;
}

/**
 * Erro cru do MySQL → AppError com o motivo real na mensagem (e no log do
 * servidor, com o começo do SQL). Módulo temporário e restrito ao dono do
 * sistema: aqui o detalhe vale mais que o texto genérico.
 */
function toAppError(error, sql = '') {
    console.error('[gapp-term-migration] MySQL:', describeMysqlError(error), '| SQL:', String(sql).replace(/\s+/g, ' ').trim().slice(0, 200));
    const legacy = /GIPP\.gs_smartphone|command denied|ER_TABLEACCESS_DENIED|ER_NO_SUCH_TABLE.*gs_smartphone/i
        .test(`${error.sqlMessage ?? ''} ${error.code ?? ''}`);
    return new AppError(
        legacy
            ? `Não foi possível ler GIPP.gs_smartphone (${describeMysqlError(error)}). Verifique se o usuário da API tem SELECT no schema GIPP.`
            : `Erro ao acessar o banco de dados da migração de termos (${describeMysqlError(error)}).`,
        500,
        { code: 'GAPP_TERM_MIGRATION_MYSQL_ERROR', details: error },
    );
}

/** Queda de conexão/timeout não é problema do arquivo: interrompe em vez de culpar cada linha. */
function isConnectionError(error) {
    return /ECONNRESET|ECONNREFUSED|PROTOCOL_CONNECTION_LOST|ETIMEDOUT|Timeout|ER_LOCK_WAIT_TIMEOUT|ER_QUERY_TIMEOUT/i
        .test(`${error?.code ?? ''} ${error?.message ?? ''}`);
}

function chunks(list, size = CHUNK) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

class MysqlTermMigrationRepository extends TermMigrationRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            const [result] = await poolGlobal.query(sql, params);
            return result;
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw toAppError(error, sql);
        }
    }

    // ── Varredura ──────────────────────────────────────────────────────────

    async findKnownPaths(paths) {
        const known = new Set();
        for (const part of chunks(paths)) {
            const rows = await this._query(q.sqlFindKnownPaths(), [part]);
            rows.forEach(row => known.add(row.source_path));
        }
        return known;
    }

    /**
     * Grava em lotes de `CHUNK`. Se um lote for recusado (um único arquivo com
     * nome que o banco não aceita derrubava o lote inteiro — e todos os
     * seguintes, a cada nova varredura), aquele lote é refeito linha a linha:
     * as boas entram e as recusadas voltam em `failed` com o motivo.
     *
     * @returns {Promise<{ inserted: number, failed: { source_path: string, reason: string }[] }>}
     */
    async insertScanned(rows) {
        const toValues = r => [
            r.source_file_name, r.source_path, r.source_file_size, r.source_modified_at,
            r.legacy_smartphone_code, r.reponsible_name, r.status, r.issue_code, r.message,
            r.created_by, r.created_by,
        ];
        let inserted = 0;
        const failed = [];

        for (const part of chunks(rows)) {
            try {
                const [result] = await poolGlobal.query(q.sqlInsertScanned(), [part.map(toValues)]);
                // ON DUPLICATE KEY sem mudança conta 0; linha nova conta 1
                inserted += Number(result.affectedRows) || 0;
                continue;
            } catch (error) {
                if (isConnectionError(error)) throw toAppError(error, q.sqlInsertScanned());
                console.error(`[gapp-term-migration] Lote da varredura recusado (${describeMysqlError(error)}); refazendo linha a linha.`);
            }
            for (const row of part) {
                try {
                    const [result] = await poolGlobal.query(q.sqlInsertScanned(), [[toValues(row)]]);
                    inserted += Number(result.affectedRows) || 0;
                } catch (error) {
                    if (isConnectionError(error)) throw toAppError(error, q.sqlInsertScanned());
                    failed.push({ source_path: row.source_path, reason: describeMysqlError(error) });
                }
            }
        }
        return { inserted, failed };
    }

    async findIdsByPaths(paths) {
        const out = [];
        for (const part of chunks(paths)) {
            out.push(...await this._query(q.sqlFindIdsByPaths(), [part]));
        }
        return out;
    }

    // ── Lotes ──────────────────────────────────────────────────────────────

    async selectBatch({ statuses, ids, limit }) {
        const { sql, params } = q.sqlSelectBatch({ statuses, ids, limit });
        return this._query(sql, params);
    }

    async selectRetryBatch({ ids, limit }) {
        const { sql, params } = q.sqlSelectRetryBatch({ ids, limit });
        return this._query(sql, params);
    }

    // ── Legado / base nova ─────────────────────────────────────────────────

    async findLegacySmartphones(codes) {
        if (!codes.length) return new Map();
        const map = new Map();
        for (const part of chunks(codes)) {
            const rows = await this._query(q.sqlLegacySmartphonesByCodes(), [part]);
            rows.forEach(row => map.set(Number(row.codigo), row));
        }
        return map;
    }

    async findSmartphonesByImeis(imeis) {
        if (!imeis.length) return [];
        const out = [];
        for (const part of chunks(imeis)) {
            out.push(...await this._query(q.sqlSmartphonesByImeis(), [part, part]));
        }
        return out;
    }

    async isSmartphoneAsset(activeId) {
        const rows = await this._query(q.sqlIsSmartphoneAsset(), [activeId]);
        return Boolean(rows[0]);
    }

    async findExistingTerm(activeId, fileHash, fileNames) {
        const names = fileNames.length ? fileNames : [''];
        const rows = await this._query(q.sqlFindExistingTerm(), [activeId, fileHash, names]);
        return rows[0] ?? null;
    }

    // ── Transições ─────────────────────────────────────────────────────────

    async applyValidation(migrationId, expectedStatus, result, userId) {
        const res = await this._query(q.sqlApplyValidation(),
            q.buildValidationParams(result, { migrationId, expectedStatus, userId }));
        return Number(res.affectedRows) > 0;
    }

    async claimForMigration(migrationId, userId) {
        const res = await this._query(q.sqlClaimForMigration(), [userId, migrationId]);
        return Number(res.affectedRows) > 0;
    }

    async markMigrated(migrationId, { assetTermId, fileId, message }, userId) {
        const res = await this._query(q.sqlMarkMigrated(), [assetTermId, fileId, message ?? null, userId, migrationId]);
        return Number(res.affectedRows) > 0;
    }

    async markFailed(migrationId, { status, issueCode, message }, userId) {
        const res = await this._query(q.sqlMarkFailed(), [status, issueCode, message, userId, migrationId]);
        return Number(res.affectedRows) > 0;
    }

    async resetToPending(migrationId, expectedStatus, userId) {
        const res = await this._query(q.sqlResetToPending(), [userId, migrationId, expectedStatus]);
        return Number(res.affectedRows) > 0;
    }

    async ignore(migrationId, message, userId) {
        const res = await this._query(q.sqlIgnore(), [message, userId, migrationId]);
        return Number(res.affectedRows) > 0;
    }

    async restore(migrationId, userId) {
        const res = await this._query(q.sqlRestore(), [userId, migrationId]);
        return Number(res.affectedRows) > 0;
    }

    // ── Consulta ───────────────────────────────────────────────────────────

    async summary() {
        const [byStatus, byIssue] = await Promise.all([
            this._query(q.sqlSummaryByStatus()),
            this._query(q.sqlSummaryByIssue()),
        ]);
        return { byStatus, byIssue };
    }

    async list(filters, pagination) {
        const { sql, params } = q.sqlListMigrations(filters, pagination);
        const { sql: countSql, params: countParams } = q.sqlCountMigrations(filters);
        const [rows, countRows] = await Promise.all([this._query(sql, params), this._query(countSql, countParams)]);
        return { rows, total: Number(countRows[0]?.total ?? 0) };
    }

    async findById(migrationId) {
        const rows = await this._query(q.sqlGetMigrationById(), [migrationId]);
        return rows[0] ?? null;
    }

    async listLogs(migrationId) {
        return this._query(q.sqlListLogs(), [migrationId]);
    }

    /**
     * Trilha. Falha aqui nunca desfaz a operação já feita — só é registrada no
     * console (a linha de controle continua sendo a fonte da verdade).
     */
    async insertLogs(entries) {
        if (!entries.length) return;
        try {
            for (const part of chunks(entries)) {
                await this._query(q.sqlInsertLogs(), [part.map(e => [
                    e.migrationId, e.action, e.fromStatus ?? null, e.toStatus, e.message ?? null, e.userId ?? null,
                ])]);
            }
        } catch (error) {
            console.error('[gapp-term-migration] Falha ao gravar a trilha:', error.message);
        }
    }
}

module.exports = { MysqlTermMigrationRepository };
