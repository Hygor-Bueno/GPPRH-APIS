/**
 * @fileoverview Adapter MySQL — implementa `TaskScopeRepositoryPort`.
 * @module modules/global/infrastructure/gtpp/mysql-task-scope.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { TaskScopeRepositoryPort } = require('../../application/gtpp/task-scope/ports/task-scope-repository.port');
const {
    SQL_GET_TASK_SCOPE,
    SQL_INSERT_TASK_SCOPE,
    SQL_DELETE_TASK_SCOPE,
} = require('../../repositories/mysql/gtpp-task-scope.queries');

class MysqlTaskScopeRepository extends TaskScopeRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.execute(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GTPP_TASK_SCOPE_MYSQL_ERROR',
                details: error,
            });
        }
    }

    async findByTask(taskId) {
        const [rows] = await this._query(SQL_GET_TASK_SCOPE, [taskId]);
        return rows;
    }

    async insert(taskId, { company_code, branch_code, cost_center_code }) {
        const [result] = await this._query(SQL_INSERT_TASK_SCOPE, [taskId, company_code, branch_code, cost_center_code]);
        return { id: result.insertId };
    }

    async remove(taskId, scopeId) {
        const [result] = await this._query(SQL_DELETE_TASK_SCOPE, [scopeId, taskId]);
        return { affectedRows: result.affectedRows };
    }
}

module.exports = { MysqlTaskScopeRepository };
