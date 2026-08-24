/**
 * @fileoverview Regra pura do motor de transição AUTOMÁTICA de estado,
 * disparado após qualquer check/uncheck/criação/remoção de item.
 *
 * Mapa completo:
 *  estado 1 + algum item marcado          → 2  (tarefa iniciada)
 *  estado 2 + nenhum item marcado         → 1  (tarefa revertida para pendente)
 *  estado 2 + todos os itens marcados     → 3  (aguardando análise)
 *  estado 3 + nem todos os itens marcados → 2  (item reaberto)
 *
 * Deliberadamente separada de `task-state-transition.rules.js`: aquela
 * valida uma transição pedida pelo usuário e lança erro; esta calcula uma
 * transição implícita e retorna um resultado — semânticas incompatíveis
 * demais para uma função só.
 *
 * @module modules/global/domain/gtpp/task/task-auto-transition.rules
 */

const { TASK_STATE } = require('./task-state.enum');

/**
 * @param {number} stateId - Estado atual da tarefa.
 * @param {{total: number, checked: number}} stats
 * @returns {{newStateId: number, historyDescription: string}|null} `null` se nenhuma transição se aplica.
 */
function computeAutoTransition(stateId, { total, checked }) {
    const allChecked = total > 0 && total === checked;
    const noneChecked = checked === 0;

    if (stateId === TASK_STATE.TODO && !noneChecked) {
        return { newStateId: TASK_STATE.DOING, historyDescription: 'Tarefa iniciada — primeiro item concluído' };
    }
    if (stateId === TASK_STATE.DOING && noneChecked) {
        return { newStateId: TASK_STATE.TODO, historyDescription: 'Todos os itens desmarcados — tarefa revertida para pendente' };
    }
    if (stateId === TASK_STATE.DOING && allChecked) {
        return { newStateId: TASK_STATE.VALIDATE, historyDescription: 'Todos os itens concluídos — aguardando análise' };
    }
    if (stateId === TASK_STATE.VALIDATE && !allChecked) {
        return { newStateId: TASK_STATE.DOING, historyDescription: 'Item reaberto — tarefa retornou para em andamento' };
    }

    return null;
}

module.exports = { computeAutoTransition };
