/**
 * @fileoverview Adapter MySQL — implementa `TaskRepositoryPort`.
 * @module modules/global/infrastructure/gtpp/mysql-task.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { TaskRepositoryPort } = require('../../application/gtpp/task/ports/task-repository.port');
const {
    buildGetTasksQuery,
    SQL_GET_TASK_DETAIL,
    SQL_INSERT_TASK,
    SQL_INSERT_TASK_USER_SELF,
    SQL_UPDATE_TASK_TITLE,
    SQL_UPDATE_TASK_DESCRIPTION,
    SQL_UPDATE_TASK_THEME,
    SQL_DELETE_TASK,
    SQL_EXTEND_TASK_FINAL_DATE,
    SQL_GET_TASK_HISTORIC,
    SQL_GET_TASK_STATES,
    SQL_GET_TASK_ITEMS,
    SQL_GET_TASK_DETAIL_USERS,
    SQL_GET_TASK_CSDS,
} = require('../../repositories/mysql/gtpp-task.queries');
const {
    SQL_AUTO_UPDATE_TASK_STATE,
    SQL_INSERT_TASK_HISTORIC,
} = require('../../repositories/mysql/gtpp-task-guard.queries');

/** Transforma uma linha raw de `buildGetTasksQuery` no formato de resposta esperado. */
function formatTaskRow(row) {
    const { colabs_raw, ...rest } = row;
    return {
        ...rest,
        percent:     Number(rest.percent     ?? 0),
        theme_id_fk: Number(rest.theme_id_fk ?? 0),
        users:       Number(rest.users       ?? 0),
        expire:      Number(rest.expire      ?? 0),
        state_id:    Number(rest.state_id),
        priority:    Number(rest.priority    ?? 0),
        user_id:     Number(rest.user_id),
        colabs: colabs_raw
            ? colabs_raw.split(',').map(uid => ({ user_id: uid }))
            : [],
        csds: [],
    };
}

class MysqlTaskRepository extends TaskRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.execute(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GTPP_TASK_MYSQL_ERROR',
                details: error,
            });
        }
    }

    async findTaskStates() {
        const [rows] = await this._query(SQL_GET_TASK_STATES);
        return rows;
    }

    async findHistoric(taskId) {
        const [rows] = await this._query(SQL_GET_TASK_HISTORIC, [taskId]);
        return rows;
    }

    async findTasksForUser(userId, { stateId = null, limit = 50, offset = 0 } = {}) {
        const { sql, extraParams } = buildGetTasksQuery({ stateId, limit, offset });
        const [rows] = await this._query(sql, [userId, userId, userId, ...extraParams]);
        return { data: rows.map(formatTaskRow), hasMore: rows.length === limit };
    }

    async findTaskDetail(taskId) {
        const [[taskRows], [rawItems], [rawUsers], [csds]] = await Promise.all([
            this._query(SQL_GET_TASK_DETAIL, [taskId]),
            this._query(SQL_GET_TASK_ITEMS, [taskId]),
            this._query(SQL_GET_TASK_DETAIL_USERS, [taskId]),
            this._query(SQL_GET_TASK_CSDS, [taskId]),
        ]);

        const task = taskRows[0];
        if (!task) return null;

        const task_item = rawItems.map(item => ({
            ...item,
            check:       Boolean(item.check),
            assigned_to: item.assigned_to ?? 0,
        }));

        const task_user = rawUsers.map(u => ({
            task_id:     u.task_id,
            user_id:     u.user_id,
            status:      Boolean(u.status),
            theme_id_fk: u.theme_id_fk,
            name:        u.name,
            photo: u.photo
                ? (Buffer.isBuffer(u.photo) ? u.photo.toString('base64') : u.photo)
                : null,
        }));

        return {
            full_description: task.full_description ?? null,
            state_id:         task.state_id,
            task_item,
            task_user,
            csds,
        };
    }

    async createTask(userId, { description, fullDescription, priority, initialDate, finalDate, themeId }) {
        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();

            const [result] = await conn.execute(SQL_INSERT_TASK, [
                description,
                fullDescription ?? null,
                userId,
                priority ?? null,
                initialDate ?? null,
                finalDate ?? null,
            ]);
            const taskId = result.insertId;

            await conn.execute(SQL_INSERT_TASK_USER_SELF, [taskId, userId, themeId ?? null]);

            await conn.commit();
            return { taskId };
        } catch (error) {
            await conn.rollback();
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao criar tarefa.', 500, {
                code: 'GTPP_TASK_MYSQL_ERROR',
                details: error,
            });
        } finally {
            conn.release();
        }
    }

    async updateStateDirect(taskId, newStateId) {
        await this._query(SQL_AUTO_UPDATE_TASK_STATE, [newStateId, taskId]);
    }

    async extendFinalDate(taskId, days) {
        await this._query(SQL_EXTEND_TASK_FINAL_DATE, [days, taskId]);
    }

    async insertHistoric(taskId, newStateId, description) {
        await this._query(SQL_INSERT_TASK_HISTORIC, [description, newStateId, taskId]);
    }

    async updateTitle(taskId, title) {
        const [result] = await this._query(SQL_UPDATE_TASK_TITLE, [title, taskId]);
        return { affectedRows: result.affectedRows };
    }

    async updateDescription(taskId, description) {
        const [result] = await this._query(SQL_UPDATE_TASK_DESCRIPTION, [description, taskId]);
        return { affectedRows: result.affectedRows };
    }

    async updateTheme(taskId, themeId, userId) {
        const [result] = await this._query(SQL_UPDATE_TASK_THEME, [themeId, taskId, userId]);
        return { affectedRows: result.affectedRows };
    }

    async deleteTask(taskId) {
        const [result] = await this._query(SQL_DELETE_TASK, [taskId]);
        return { affectedRows: result.affectedRows };
    }
}

module.exports = { MysqlTaskRepository };
