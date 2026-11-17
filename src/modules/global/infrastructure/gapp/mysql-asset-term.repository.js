/**
 * @fileoverview Adapter MySQL — implementa `AssetTermRepositoryPort`.
 *
 * @module modules/global/infrastructure/gapp/mysql-asset-term.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { AssetTermRepositoryPort } = require('../../application/gapp/asset-term/ports/asset-term-repository.port');
const {
    sqlListAssetTerms, sqlCountAssetTerms, sqlGetAssetTermById,
    sqlCheckActiveExists, sqlCountFileReferences,
    sqlInsertAssetTerm, buildInsertAssetTermParams,
    sqlUpdateAssetTerm, buildUpdateAssetTermParams,
    sqlDeleteAssetTerm, sqlInactivateAssetTerms,
} = require('../../repositories/mysql/gapp-asset-term.queries');

class MysqlAssetTermRepository extends AssetTermRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.query(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GAPP_ASSET_TERM_MYSQL_ERROR',
                details: error
            });
        }
    }

    async list(filters) {
        const { sql, params } = sqlListAssetTerms(filters);
        const { sql: countSql, params: countParams } = sqlCountAssetTerms(filters);
        const [rows] = await this._query(sql, params);
        const [[{ total }]] = await this._query(countSql, countParams);
        return { items: rows, total, page: Number(filters.page) || 1, limit: Number(filters.limit) || 20 };
    }

    async findById(id) {
        const [rows] = await this._query(sqlGetAssetTermById(), [id]);
        return rows[0] ?? null;
    }

    async activeExists(activeId) {
        const [rows] = await this._query(sqlCheckActiveExists(), [activeId]);
        return Boolean(rows[0]);
    }

    async countFileReferences(fileId, ignoreAssetTermId = 0) {
        const [[{ total }]] = await this._query(sqlCountFileReferences(), [fileId, ignoreAssetTermId]);
        return Number(total);
    }

    /** @private Executa `work(conn)` numa transação: tudo grava ou nada grava. */
    async _transaction(work) {
        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();
            const result = await work(conn);
            await conn.commit();
            return result;
        } catch (error) {
            await conn.rollback();
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, { code: 'GAPP_ASSET_TERM_MYSQL_ERROR', details: error });
        } finally {
            conn.release();
        }
    }

    /** Novo termo vira o vínculo atual: inativa os anteriores do ativo e insere, na mesma transação. */
    async insert(fields) {
        return this._transaction(async conn => {
            await conn.query(sqlInactivateAssetTerms(), [fields.active_id_fk]);
            const [result] = await conn.query(sqlInsertAssetTerm(), buildInsertAssetTermParams(fields));
            return { insertId: result.insertId };
        });
    }

    /** Desvincula o colaborador: inativa o termo ativo do ativo. */
    async inactivateByActive(activeId) {
        const [result] = await this._query(sqlInactivateAssetTerms(), [activeId]);
        return { updated: result.affectedRows };
    }

    async update(id, fields) {
        const [result] = await this._query(sqlUpdateAssetTerm(), buildUpdateAssetTermParams(fields, id));
        return { updated: result.affectedRows };
    }

    async delete(id) {
        const [result] = await this._query(sqlDeleteAssetTerm(), [id]);
        return { deleted: result.affectedRows };
    }
}

module.exports = { MysqlAssetTermRepository };
