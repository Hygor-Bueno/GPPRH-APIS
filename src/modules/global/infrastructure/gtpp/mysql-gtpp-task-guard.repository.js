/**
 * @fileoverview Adapter MySQL — implementa `GtppTaskGuardRepositoryPort`.
 *
 * @module modules/global/infrastructure/gtpp/mysql-gtpp-task-guard.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { GtppTaskGuardRepositoryPort } = require('../../application/gtpp/ports/gtpp-task-guard-repository.port');
const {
    SQL_GET_TASK_USER_ID, SQL_GET_TASK_STATE, SQL_AUTO_UPDATE_TASK_STATE,
    SQL_INSERT_TASK_HISTORIC, SQL_COUNT_ITEM_STATS,
} = require('../../repositories/mysql/gtpp-task-guard.queries');

class MysqlGtppTaskGuardRepository extends GtppTaskGuardRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.execute(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GTPP_TASK_GUARD_MYSQL_ERROR',
                details: error
            });
        }
    }

    async findStateAndCreator(taskId) {
        const [[stateRow]] = await this._query(SQL_GET_TASK_STATE, [taskId]);
        if (!stateRow) return null;
        const [[creatorRow]] = await this._query(SQL_GET_TASK_USER_ID, [taskId]);
        return { stateId: stateRow.state_id, creatorId: creatorRow?.user_id ?? null };
    }

    async findItemStats(taskId) {
        const [[stats]] = await this._query(SQL_COUNT_ITEM_STATS, [taskId]);
        return { total: Number(stats?.total ?? 0), checked: Number(stats?.checked ?? 0) };
    }

    async applyStateTransition(taskId, newStateId, historyDescription) {
        await this._query(SQL_AUTO_UPDATE_TASK_STATE, [newStateId, taskId]);
        await this._query(SQL_INSERT_TASK_HISTORIC, [historyDescription, newStateId, taskId]);
    }
}

module.exports = { MysqlGtppTaskGuardRepository };
