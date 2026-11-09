/**
 * @fileoverview Adapter MySQL — implementa `AssetTermTemplateRepositoryPort`.
 *
 * @module modules/global/infrastructure/gapp/mysql-asset-term-template.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { AssetTermTemplateRepositoryPort } = require('../../application/gapp/asset-term-template/ports/asset-term-template-repository.port');
const {
    sqlListTemplates, sqlGetTemplateById, sqlCheckTemplateName,
    sqlInsertTemplate, buildInsertTemplateParams,
    sqlUpdateTemplate, buildUpdateTemplateParams,
} = require('../../repositories/mysql/gapp-asset-term-template.queries');

class MysqlAssetTermTemplateRepository extends AssetTermTemplateRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.query(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GAPP_ASSET_TERM_TEMPLATE_MYSQL_ERROR',
                details: error
            });
        }
    }

    async list(filters) {
        const { sql, params } = sqlListTemplates(filters);
        const [rows] = await this._query(sql, params);
        return rows;
    }

    async findById(id) {
        const [rows] = await this._query(sqlGetTemplateById(), [id]);
        return rows[0] ?? null;
    }

    async nameExists(name, assetType, ignoreId = 0) {
        const [rows] = await this._query(sqlCheckTemplateName(), [name, assetType, ignoreId]);
        return Boolean(rows[0]);
    }

    async insert(fields) {
        const [result] = await this._query(sqlInsertTemplate(), buildInsertTemplateParams(fields));
        return { insertId: result.insertId };
    }

    async update(id, fields) {
        const [result] = await this._query(sqlUpdateTemplate(), buildUpdateTemplateParams(fields, id));
        return { updated: result.affectedRows };
    }
}

module.exports = { MysqlAssetTermTemplateRepository };
