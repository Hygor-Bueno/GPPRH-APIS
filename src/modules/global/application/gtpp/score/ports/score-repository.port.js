/**
 * @fileoverview Porta (contrato) de persistência MySQL para pontuação GTPP.
 *
 * @module modules/global/application/gtpp/score/ports/score-repository.port
 */

class ScoreRepositoryPort {
    /** @param {number} userId @returns {Promise<object|null>} */
    findScore(userId) { throw new Error('Not implemented'); }

    /** @returns {Promise<{id: number, user: string}[]>} */
    findAllUsersWithAccess() { throw new Error('Not implemented'); }

    /** @param {number} taskId @returns {Promise<{disqualify: 0|1}|null>} */
    findDisqualify(taskId) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {0|1} disqualify @returns {Promise<{updated: number}>} */
    updateDisqualify(taskId, disqualify) { throw new Error('Not implemented'); }
}

module.exports = { ScoreRepositoryPort };
