/**
 * @fileoverview Validação pura das datas de prazo de um item de tarefa GTPP,
 * contra as datas da tarefa pai e entre si.
 *
 * @module modules/global/domain/gtpp/task-item/item-dates.validator
 */

const { AppError } = require('../../../../../errors/app.error');

/**
 * Valida e normaliza uma data no formato YYYY-MM-DD.
 * @param {string} value
 * @param {string} fieldName
 * @returns {string}
 * @throws {AppError} 400
 */
function parseDate(value, fieldName) {
    const d = new Date(value);
    if (isNaN(d.getTime())) throw new AppError(`Data inválida para "${fieldName}". Use o formato YYYY-MM-DD.`, 400);
    return value;
}

/**
 * Valida as datas do item contra a tarefa pai e entre si.
 * @param {string|null} initialDate
 * @param {string|null} finalDate
 * @param {{ initial_date: string|null, final_date: string|null }} taskDates
 * @throws {AppError} 400
 */
function validateItemDates(initialDate, finalDate, taskDates) {
    if (!initialDate && !finalDate) return;

    if (!initialDate || !finalDate) {
        throw new AppError('initial_date e final_date devem ser informados juntos.', 400);
    }

    if (initialDate >= finalDate) {
        throw new AppError('A data de início do item deve ser anterior à data de fim.', 400);
    }

    if (taskDates.initial_date && initialDate < taskDates.initial_date) {
        throw new AppError(
            `A data de início do item (${initialDate}) não pode ser anterior à data de início da tarefa (${taskDates.initial_date}).`,
            400
        );
    }

    if (taskDates.final_date && finalDate > taskDates.final_date) {
        throw new AppError(
            `A data de fim do item (${finalDate}) não pode ultrapassar a data de fim da tarefa (${taskDates.final_date}).`,
            400
        );
    }
}

module.exports = { parseDate, validateItemDates };
