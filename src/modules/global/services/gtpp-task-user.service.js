/**
 * @fileoverview Serviço de usuários vinculados a tarefas GTPP.
 * @module modules/global/services/gtpp-task-user.service
 */

'use strict';

const { poolGlobal } = require('../../../config/mysql');
const { AppError }   = require('../../../errors/app.error');
const {
    SQL_GET_TASK_USERS,
    SQL_CHECK_USER_IN_TASK,
    SQL_INSERT_TASK_USER,
    SQL_DELETE_TASK_USER,
} = require('../repositories/mysql/gtpp.repository');

/**
 * Lista todos os usuários com acesso GTPP, marcando os vinculados à tarefa.
 * O criador não aparece na lista (já é implicitamente o dono).
 * @param {number} taskId
 */
async function getTaskUsers(taskId) {
    try {
        const [rows] = await poolGlobal.execute(SQL_GET_TASK_USERS, [taskId, taskId, taskId]);
        return rows.map(r => ({ ...r, check: Boolean(r.check) }));
    } catch (err) {
        throw new AppError('Erro ao buscar usuários da tarefa.', 500, err.code, err);
    }
}

/**
 * Alterna o vínculo de um usuário à tarefa (add ↔ remove).
 * @param {number} taskId
 * @param {number} userId - Usuário a vincular/desvincular
 * @returns {Promise<{ action: 'added'|'removed' }>}
 */
async function toggleTaskUser(taskId, userId) {
    try {
        const [[{ count }]] = await poolGlobal.execute(
            SQL_CHECK_USER_IN_TASK,
            [taskId, userId, taskId, userId]
        );

        if (Number(count) === 0) {
            await poolGlobal.execute(SQL_INSERT_TASK_USER, [taskId, userId]);
            return { action: 'added' };
        } else {
            await poolGlobal.execute(SQL_DELETE_TASK_USER, [taskId, userId]);
            return { action: 'removed' };
        }
    } catch (err) {
        throw new AppError('Erro ao atualizar vínculo do usuário.', 500, err.code, err);
    }
}

module.exports = {
    getTaskUsers,
    toggleTaskUser,
};
