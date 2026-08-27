/**
 * @fileoverview Regra pura: em quais estados uma tarefa pode ser editada.
 *
 * @module modules/global/domain/gtpp/task/task-editability.rules
 */

const { AppError } = require('../../../../../errors/app.error');
const { TASK_STATE } = require('./task-state.enum');

/** Estados em que a tarefa está "fechada" e não aceita mais edição. */
const BLOCKED_STATES = [TASK_STATE.EXPIRED, TASK_STATE.DONE, TASK_STATE.CANCELED, TASK_STATE.ARCHIVED];

/** @param {number} stateId @returns {boolean} */
function isTaskEditable(stateId) {
    return !BLOCKED_STATES.includes(stateId);
}

/**
 * @param {number} stateId
 * @throws {AppError} 400 se a tarefa não puder ser editada neste estado.
 */
function assertTaskEditable(stateId) {
    if (!isTaskEditable(stateId)) {
        throw new AppError('Esta tarefa não pode ser modificada no estado atual.', 400);
    }
}

module.exports = { BLOCKED_STATES, isTaskEditable, assertTaskEditable };
