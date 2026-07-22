/**
 * @fileoverview Serviço de pontuação GTPP.
 * @module modules/global/services/gtpp-score.service
 */

'use strict';

const { poolGlobal } = require('../../../config/mysql');
const { AppError }   = require('../../../errors/app.error');
const {
    SQL_GET_SCORE,
    SQL_GET_DISQUALIFY,
    SQL_UPDATE_DISQUALIFY,
    SQL_GET_ALL_USERS_WITH_ACCESS,
} = require('../repositories/mysql/gtpp.repository');

/** IDs de usuários cujas pontuações ficam ocultas (administradores do sistema). */
const LOCKED_USER_IDS = [3, 4];

/** Pontuação zero para usuários sem tarefas. */
const EMPTY_SCORE = {
    score: 0,
    user_task_count: 0,
    attached_task_count: 0,
    current_task_count: 0,
    finished_task_count: 0,
    disqualify_task_count: 0,
};

/**
 * Calcula a pontuação de um usuário (query com 15 parâmetros userId).
 * @param {number} userId
 */
async function getUserScore(userId) {
    try {
        const params = Array(15).fill(userId);
        const [[row]] = await poolGlobal.execute(SQL_GET_SCORE, params);
        return row ?? { ...EMPTY_SCORE };
    } catch (err) {
        throw new AppError('Erro ao buscar pontuação.', 500, err.code, err);
    }
}

/**
 * Retorna a pontuação de todos os usuários com acesso GTPP, ordenada por score.
 * Usuários com IDs em `LOCKED_USER_IDS` têm dados ocultados.
 */
async function getAllUsersScore() {
    try {
        const [users] = await poolGlobal.execute(SQL_GET_ALL_USERS_WITH_ACCESS);

        const results = await Promise.all(
            users.map(async (u) => {
                if (LOCKED_USER_IDS.includes(u.id)) {
                    return {
                        id: u.id, user: u.user,
                        score: '- 🔒 -', user_task_count: '- 🔒 -',
                        attached_task_count: '- 🔒 -', current_task_count: '- 🔒 -',
                        finished_task_count: '- 🔒 -', disqualify_task_count: '- 🔒 -',
                    };
                }

                try {
                    const score = await getUserScore(u.id);
                    return { id: u.id, user: u.user, ...score };
                } catch {
                    return { id: u.id, user: u.user, ...EMPTY_SCORE };
                }
            })
        );

        // Ordena por score desc; usuários bloqueados vão ao final
        results.sort((a, b) => {
            if (typeof a.score === 'string') return 1;
            if (typeof b.score === 'string') return -1;
            return b.score - a.score;
        });

        return results;
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Erro ao buscar pontuações.', 500, err.code, err);
    }
}

/**
 * Retorna o status de desqualificação de uma tarefa.
 * @param {number} taskId
 * @returns {Promise<0|1>}
 */
async function getTaskDisqualify(taskId) {
    try {
        const [[row]] = await poolGlobal.execute(SQL_GET_DISQUALIFY, [taskId]);
        if (!row) throw new AppError('Tarefa não encontrada.', 404);
        return row.disqualify;
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Erro ao buscar status de desqualificação.', 500, err.code, err);
    }
}

/**
 * Atualiza o flag de desqualificação de uma tarefa.
 * @param {number} taskId
 * @param {0|1} disqualify
 */
async function updateTaskDisqualify(taskId, disqualify) {
    try {
        const [result] = await poolGlobal.execute(SQL_UPDATE_DISQUALIFY, [disqualify, taskId]);
        if (result.affectedRows === 0) throw new AppError('Tarefa não encontrada.', 404);
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Erro ao atualizar desqualificação.', 500, err.code, err);
    }
}

module.exports = {
    getUserScore,
    getAllUsersScore,
    getTaskDisqualify,
    updateTaskDisqualify,
};
