/**
 * @fileoverview Controller de pontuação GTPP.
 * @module modules/global/controllers/gtpp-score.controller
 */

'use strict';

const { AppError }  = require('../../../errors/app.error');
const { respond }   = require('../../../utils/respond');
const scoreService  = require('../services/gtpp-score.service');

/**
 * GET /gtpp/score
 * Retorna pontuação conforme parâmetros:
 * - ?all=no (padrão) → pontuação do usuário autenticado
 * - ?all=yes         → pontuação de todos os usuários com acesso GTPP
 * - ?task_id=X       → status de desqualificação de uma tarefa
 */
async function getScore(req, res) {
    const { all, task_id } = req.query;

    if (task_id) {
        const disqualify = await scoreService.getTaskDisqualify(parseInt(task_id, 10));
        return respond.ok(res, { disqualify });
    }

    if (!all || all === 'no') {
        const score = await scoreService.getUserScore(req.user.id);
        return respond.ok(res, score);
    }

    if (all === 'yes') {
        const scores = await scoreService.getAllUsersScore();
        return respond.ok(res, scores);
    }

    throw new AppError('Parâmetro "all" inválido. Use "yes" ou "no".', 400);
}

/**
 * PUT /gtpp/score/disqualify
 * Atualiza o flag de desqualificação de uma tarefa.
 * Query params: task_id, disqualify (0 ou 1)
 */
async function updateDisqualify(req, res) {
    const taskId     = req.query.task_id    ? parseInt(req.query.task_id, 10)    : null;
    const disqualify = req.query.disqualify !== undefined ? parseInt(req.query.disqualify, 10) : null;

    if (!taskId)                             throw new AppError('O parâmetro task_id é obrigatório.', 400);
    if (disqualify !== 0 && disqualify !== 1) throw new AppError('O parâmetro disqualify deve ser 0 ou 1.', 400);

    await scoreService.updateTaskDisqualify(taskId, disqualify);
    return respond.message(res, 'Desqualificação atualizada com sucesso.');
}

module.exports = {
    getScore,
    updateDisqualify,
};
