/**
 * @fileoverview Adapter MySQL — implementa `ThemeRepositoryPort`.
 *
 * @module modules/global/infrastructure/gtpp/mysql-theme.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { ThemeRepositoryPort } = require('../../application/gtpp/theme/ports/theme-repository.port');
const {
    SQL_GET_ALL_THEMES, SQL_GET_THEME_BY_ID, SQL_GET_THEMES_BY_USER,
    SQL_INSERT_THEME, SQL_UPDATE_THEME, SQL_DELETE_THEME,
} = require('../../repositories/mysql/gtpp-theme.queries');

class MysqlThemeRepository extends ThemeRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.execute(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GTPP_THEME_MYSQL_ERROR',
                details: error
            });
        }
    }

    async findAll() {
        const [rows] = await this._query(SQL_GET_ALL_THEMES);
        return rows;
    }

    async findById(id) {
        const [rows] = await this._query(SQL_GET_THEME_BY_ID, [id]);
        return rows[0] ?? null;
    }

    async findByUser(userId) {
        const [rows] = await this._query(SQL_GET_THEMES_BY_USER, [userId]);
        return rows;
    }

    async insert(description, userId) {
        const [result] = await this._query(SQL_INSERT_THEME, [description, userId]);
        return { insertId: result.insertId };
    }

    async update(id, description) {
        const [result] = await this._query(SQL_UPDATE_THEME, [description, id]);
        return { updated: result.affectedRows };
    }

    async remove(id) {
        const [result] = await this._query(SQL_DELETE_THEME, [id]);
        return { deleted: result.affectedRows };
    }
}

module.exports = { MysqlThemeRepository };
