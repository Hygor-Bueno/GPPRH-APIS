/**
 * @fileoverview Porta de agendamentos e seus alvos.
 *
 * Compartilhada entre a sub-feature `schedule` (painel) e a sub-feature
 * `device` (que lê os ativos para resolver o que tocar), por isso leva o
 * prefixo da suite.
 *
 * @module modules/global/application/meipp/ports/meipp-schedule-repository.port
 */

class MeippScheduleRepositoryPort {
    /** @param {object} filters @returns {Promise<{rows: object[], total: number}>} */
    list(filters) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<object|null>} */
    findById(id) { throw new Error('Not implemented'); }

    /**
     * Todos os ativos, com `targets` já em array — entrada do
     * `schedule-resolver.rules`.
     * @returns {Promise<object[]>}
     */
    findActiveWithTargets() { throw new Error('Not implemented'); }

    /** @param {object} payload @returns {Promise<number>} */
    create(payload) { throw new Error('Not implemented'); }

    /** @param {number} id @param {object} payload @returns {Promise<void>} */
    update(id, payload) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<void>} */
    remove(id) { throw new Error('Not implemented'); }

    /** @param {number} scheduleId @returns {Promise<object[]>} */
    findTargets(scheduleId) { throw new Error('Not implemented'); }

    /** @param {number} scheduleId @param {object} target @returns {Promise<number>} */
    addTarget(scheduleId, target) { throw new Error('Not implemented'); }

    /** @param {number} scheduleId @param {number} targetId @returns {Promise<boolean>} */
    removeTarget(scheduleId, targetId) { throw new Error('Not implemented'); }

    /**
     * `meipp_schedule_targets.target_id` é polimórfico e não tem FK — a
     * existência do alvo é conferida aqui antes de gravar.
     * @param {string} targetType - `player` ou `group`.
     * @param {number} targetId
     * @returns {Promise<boolean>}
     */
    targetExists(targetType, targetId) { throw new Error('Not implemented'); }
}

module.exports = { MeippScheduleRepositoryPort };
