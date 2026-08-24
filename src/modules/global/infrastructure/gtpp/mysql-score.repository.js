/**
 * @fileoverview Adapter MySQL — implementa `ScoreRepositoryPort`.
 *
 * @module modules/global/infrastructure/gtpp/mysql-score.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { ScoreRepositoryPort } = require('../../application/gtpp/score/ports/score-repository.port');
const {
    SQL_GET_SCORE, SQL_GET_DISQUALIFY, SQL_UPDATE_DISQUALIFY, SQL_GET_ALL_USERS_WITH_ACCESS,
} = require('../../repositories/mysql/gtpp-score.queries');

class MysqlScoreRepository extends ScoreRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.execute(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GTPP_SCORE_MYSQL_ERROR',
                details: error
            });
        }
    }

    /** A query espera 15 parâmetros, todos o mesmo userId (herança do SQL original). */
    async findScore(userId) {
        const params = Array(15).fill(userId);
        const [rows] = await this._query(SQL_GET_SCORE, params);
        return rows[0] ?? null;
    }

    async findAllUsersWithAccess() {
        const [rows] = await this._query(SQL_GET_ALL_USERS_WITH_ACCESS);
        return rows;
    }

    async findDisqualify(taskId) {
        const [rows] = await this._query(SQL_GET_DISQUALIFY, [taskId]);
        return rows[0] ?? null;
    }

    async updateDisqualify(taskId, disqualify) {
        const [result] = await this._query(SQL_UPDATE_DISQUALIFY, [disqualify, taskId]);
        return { updated: result.affectedRows };
    }
}

module.exports = { MysqlScoreRepository };
