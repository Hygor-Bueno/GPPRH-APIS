/**
 * @fileoverview Adapter MySQL — implementa `TaskUserRepositoryPort`.
 * @module modules/global/infrastructure/gtpp/mysql-task-user.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { TaskUserRepositoryPort } = require('../../application/gtpp/task-user/ports/task-user-repository.port');
const {
    SQL_GET_TASK_PARTICIPANT_IDS,
    SQL_GET_TASK_USERS,
    SQL_CHECK_USER_IN_TASK,
    SQL_INSERT_TASK_USER,
    SQL_DELETE_TASK_USER,
} = require('../../repositories/mysql/gtpp-task-user.queries');

class MysqlTaskUserRepository extends TaskUserRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.execute(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GTPP_TASK_USER_MYSQL_ERROR',
                details: error
            });
        }
    }

    async findAllParticipantIds(taskId) {
        const [rows] = await this._query(SQL_GET_TASK_PARTICIPANT_IDS, [taskId, taskId]);
        return rows.map(r => r.user_id);
    }

    async findTaskUsers(taskId) {
        const [rows] = await this._query(SQL_GET_TASK_USERS, [taskId, taskId]);
        return rows.map(r => ({ ...r, check: Boolean(r.check) }));
    }

    async isUserInTask(taskId, userId) {
        const [[{ count }]] = await this._query(SQL_CHECK_USER_IN_TASK, [taskId, userId, taskId, userId]);
        return Number(count) > 0;
    }

    async addUser(taskId, userId) {
        await this._query(SQL_INSERT_TASK_USER, [taskId, userId]);
    }

    async removeUser(taskId, userId) {
        await this._query(SQL_DELETE_TASK_USER, [taskId, userId]);
    }
}

module.exports = { MysqlTaskUserRepository };
