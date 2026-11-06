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
    sqlDeleteAssetTerm,
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

    async insert(fields) {
        const [result] = await this._query(sqlInsertAssetTerm(), buildInsertAssetTermParams(fields));
        return { insertId: result.insertId };
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
