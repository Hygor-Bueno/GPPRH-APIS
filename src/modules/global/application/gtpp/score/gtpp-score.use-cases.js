/**
 * @fileoverview Casos de uso — Pontuação GTPP.
 *
 * @module modules/global/application/gtpp/score/gtpp-score.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const {
    EMPTY_SCORE, isLockedUser, buildLockedScoreRow, buildScoreRow, sortScoreResults,
} = require('../../../domain/gtpp/score/score-list.shaper');

class GtppScoreUseCases {
    /** @param {{repository: import('./ports/score-repository.port').ScoreRepositoryPort}} deps */
    constructor({ repository }) {
        this.repository = repository;
    }

    async getUserScore(userId) {
        const row = await this.repository.findScore(userId);
        return row ?? { ...EMPTY_SCORE };
    }

    /**
     * Retorna a pontuação de todos os usuários com acesso GTPP, ordenada por score.
     * Usuários bloqueados (`LOCKED_USER_IDS`) têm os dados mascarados.
     */
    async getAllUsersScore() {
        const users = await this.repository.findAllUsersWithAccess();

        const results = await Promise.all(
            users.map(async (user) => {
                if (isLockedUser(user.id)) return buildLockedScoreRow(user);

                try {
                    const score = await this.getUserScore(user.id);
                    return buildScoreRow(user, score);
                } catch {
                    return buildScoreRow(user, { ...EMPTY_SCORE });
                }
            })
        );

        return sortScoreResults(results);
    }

    /** @throws {AppError} 404 se a tarefa não existir. */
    async getTaskDisqualify(taskId) {
        const row = await this.repository.findDisqualify(taskId);
        if (!row) throw new AppError('Tarefa não encontrada.', 404);
        return row.disqualify;
    }

    /** @throws {AppError} 404 se a tarefa não existir. */
    async updateTaskDisqualify(taskId, disqualify) {
        const { updated } = await this.repository.updateDisqualify(taskId, disqualify);
        if (updated === 0) throw new AppError('Tarefa não encontrada.', 404);
    }
}

module.exports = { GtppScoreUseCases };
