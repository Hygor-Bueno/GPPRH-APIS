/**
 * @fileoverview Adapter MySQL — implementa `GappUserRepositoryPort`.
 *
 * @module modules/global/infrastructure/gapp/mysql-gapp-user.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { GappUserRepositoryPort } = require('../../application/gapp/ports/gapp-user-repository.port');
const { sqlGetUserAuthByAccessCode } = require('../../repositories/mysql/gapp-user.queries');

class MysqlGappUserRepository extends GappUserRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.query(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GAPP_USER_MYSQL_ERROR',
                details: error
            });
        }
    }

    async findAuthByAccessCode(accessCode) {
        const [rows] = await this._query(sqlGetUserAuthByAccessCode(), [accessCode]);
        return rows[0] ?? null;
    }
}

module.exports = { MysqlGappUserRepository };
