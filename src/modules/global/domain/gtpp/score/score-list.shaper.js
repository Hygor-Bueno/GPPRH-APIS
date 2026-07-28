/**
 * @fileoverview Reformatação e ordenação pura da lista de pontuação GTPP.
 *
 * @module modules/global/domain/gtpp/score/score-list.shaper
 */

/** IDs de usuários cujas pontuações ficam ocultas (administradores do sistema). */
const LOCKED_USER_IDS = [3, 4];

const LOCKED_PLACEHOLDER = '- 🔒 -';

/** Pontuação zero para usuários sem tarefas. */
const EMPTY_SCORE = {
    score: 0,
    user_task_count: 0,
    attached_task_count: 0,
    current_task_count: 0,
    finished_task_count: 0,
    disqualify_task_count: 0,
};

/** @param {number} userId @returns {boolean} */
function isLockedUser(userId) {
    return LOCKED_USER_IDS.includes(userId);
}

/** @param {{id: number, user: string}} user @returns {object} Linha com todos os campos mascarados. */
function buildLockedScoreRow(user) {
    return {
        id: user.id,
        user: user.user,
        score: LOCKED_PLACEHOLDER,
        user_task_count: LOCKED_PLACEHOLDER,
        attached_task_count: LOCKED_PLACEHOLDER,
        current_task_count: LOCKED_PLACEHOLDER,
        finished_task_count: LOCKED_PLACEHOLDER,
        disqualify_task_count: LOCKED_PLACEHOLDER,
    };
}

/**
 * @param {{id: number, user: string}} user
 * @param {object} score
 * @returns {object}
 */
function buildScoreRow(user, score) {
    return { id: user.id, user: user.user, ...score };
}

/**
 * Ordena por score desc; usuários bloqueados (score em string) vão ao final.
 * @param {object[]} results
 * @returns {object[]} Novo array ordenado (não muta o original).
 */
function sortScoreResults(results) {
    return [...results].sort((a, b) => {
        if (typeof a.score === 'string') return 1;
        if (typeof b.score === 'string') return -1;
        return b.score - a.score;
    });
}

module.exports = {
    LOCKED_USER_IDS,
    EMPTY_SCORE,
    isLockedUser,
    buildLockedScoreRow,
    buildScoreRow,
    sortScoreResults,
};
