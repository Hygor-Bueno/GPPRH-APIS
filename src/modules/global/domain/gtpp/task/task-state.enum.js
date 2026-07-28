/**
 * @fileoverview Estados de tarefa GTPP (gt_task_state).
 *
 * @module modules/global/domain/gtpp/task/task-state.enum
 */

const TASK_STATE = Object.freeze({
    TODO: 1,
    DOING: 2,
    VALIDATE: 3,
    STOPPED: 4,
    EXPIRED: 5,
    DONE: 6,
    CANCELED: 7,
    ARCHIVED: 8,
});

module.exports = { TASK_STATE };
