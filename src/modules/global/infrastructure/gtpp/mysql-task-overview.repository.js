/**
 * @fileoverview Adapter MySQL — implementa `TaskOverviewRepositoryPort`.
 * @module modules/global/infrastructure/gtpp/mysql-task-overview.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { TaskOverviewRepositoryPort } = require('../../application/gtpp/task-overview/ports/task-overview-repository.port');
const { CLOSED_STATES } = require('../../domain/gtpp/task-overview/task-overview-filter.rules');
const {
    buildTaskOverviewQuery,
    buildTaskOverviewSummaryQuery,
    SQL_FIND_USER_IDS_BY_EMPLOYEE,
} = require('../../repositories/mysql/gtpp-task-overview.queries');

function formatOverviewRow(row) {
    const { colabs_raw, ...rest } = row;
    return {
        ...rest,
        percent:  Number(rest.percent  ?? 0),
        expire:   rest.expire == null ? null : Number(rest.expire),
        state_id: Number(rest.state_id),
        priority: Number(rest.priority ?? 0),
        user_id:  Number(rest.user_id),
        users:    colabs_raw ? colabs_raw.split(',').length : 0,
        colabs:   colabs_raw ? colabs_raw.split(',').map(uid => ({ user_id: uid })) : [],
    };
}

class MysqlTaskOverviewRepository extends TaskOverviewRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.execute(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GTPP_TASK_OVERVIEW_MYSQL_ERROR',
                details: error,
            });
        }
    }

    async findTasks(filters) {
        const { sql, params } = buildTaskOverviewQuery(filters, CLOSED_STATES);
        const [rows] = await this._query(sql, params);
        const hasMore = rows.length > filters.limit;
        return { data: rows.slice(0, filters.limit).map(formatOverviewRow), hasMore };
    }

    async findUserIdsByEmployee({ registration, branchCode }) {
        const [rows] = await this._query(SQL_FIND_USER_IDS_BY_EMPLOYEE, [registration, branchCode]);
        return rows.map(r => Number(r.id));
    }

    async countByState(filters) {
        const { sql, params } = buildTaskOverviewSummaryQuery(filters, CLOSED_STATES);
        const [rows] = await this._query(sql, params);
        return rows.map(r => ({ ...r, state_id: Number(r.state_id), total: Number(r.total) }));
    }
}

module.exports = { MysqlTaskOverviewRepository };
