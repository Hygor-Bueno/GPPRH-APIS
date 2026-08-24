/**
 * @fileoverview Regras puras de transição MANUAL de estado (PUT .../state).
 *
 * Regras:
 *  → 1 (Fazer)    : nenhum item pode estar marcado
 *  → 2 (Fazendo)  : livre
 *  → 3 (Validar)  : todos os itens precisam estar marcados
 *  → 4 (Parado)   : livre
 *  → 5 (Expirado) : apenas MANAGE_GTPP (verificado no controller, fora do domínio)
 *  → 6 (Feito)    : estado atual deve ser 3 (Validar)
 *  → 7 (Cancelado): livre
 *  → 8 (Arquivado): estado atual deve ser 6 (Feito)
 *
 * @module modules/global/domain/gtpp/task/task-state-transition.rules
 */

const { AppError } = require('../../../../../errors/app.error');
const { TASK_STATE } = require('./task-state.enum');

/**
 * Valida a parte 100% estrutural da transição (não depende de contagem de itens).
 * @param {number} newStateId
 * @param {number} currentStateId
 * @throws {AppError} 400
 */
function assertStructurallyAllowed(newStateId, currentStateId) {
    if (newStateId === TASK_STATE.DONE && currentStateId !== TASK_STATE.VALIDATE) {
        throw new AppError('A tarefa só pode ser marcada como "Feito" a partir do estado "Validar".', 400);
    }

    if (newStateId === TASK_STATE.ARCHIVED && currentStateId !== TASK_STATE.DONE) {
        throw new AppError('A tarefa só pode ser arquivada a partir do estado "Feito".', 400);
    }
}

/**
 * @param {number} newStateId
 * @returns {boolean} true se a transição exige contagem de itens (busca no banco).
 */
function needsItemCountCheck(newStateId) {
    return newStateId === TASK_STATE.TODO || newStateId === TASK_STATE.VALIDATE;
}

/**
 * @param {number} newStateId
 * @param {{total: number, checked: number}} stats
 * @throws {AppError} 400
 */
function assertItemCountAllows(newStateId, { total, checked }) {
    if (newStateId === TASK_STATE.TODO && checked > 0) {
        throw new AppError('Desmarque todos os itens antes de reverter para "Fazer".', 400);
    }

    if (newStateId === TASK_STATE.VALIDATE && (total === 0 || checked < total)) {
        throw new AppError('Marque todos os itens antes de mover para "Validar".', 400);
    }
}

module.exports = { assertStructurallyAllowed, needsItemCountCheck, assertItemCountAllows };
