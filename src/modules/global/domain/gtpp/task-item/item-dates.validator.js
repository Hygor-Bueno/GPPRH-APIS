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
 * `YYYY-MM-DD` no horário local. Aceita `Date` (o mysql2 devolve coluna DATE
 * como `Date` à meia-noite local) ou string já nesse formato.
 * @param {Date|string|null} value
 * @returns {string|null}
 */
function toDayKey(value) {
    if (value == null) return null;
    if (typeof value === 'string') return value.slice(0, 10);
    const d = new Date(value);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Valida as datas do item contra a tarefa pai e entre si.
 *
 * As datas da tarefa são normalizadas para string antes de comparar: vindas
 * do banco como `Date`, `'2026-01-05' < Date` é sempre `false` e o limite da
 * tarefa nunca era aplicado.
 *
 * @param {string|null} initialDate
 * @param {string|null} finalDate
 * @param {{ initial_date: Date|string|null, final_date: Date|string|null }} taskDates
 * @throws {AppError} 400
 */
function validateItemDates(initialDate, finalDate, taskDates) {
    if (!initialDate && !finalDate) return;

    if (!initialDate || !finalDate) {
        throw new AppError('initial_date e final_date devem ser informados juntos.', 400);
    }

    if (initialDate > finalDate) {
        throw new AppError('A data de início do item não pode ser posterior à data de fim.', 400);
    }

    const taskInitial = toDayKey(taskDates.initial_date);
    const taskFinal   = toDayKey(taskDates.final_date);

    if (taskInitial && initialDate < taskInitial) {
        throw new AppError(
            `A data de início do item (${initialDate}) não pode ser anterior à data de início da tarefa (${taskInitial}).`,
            400
        );
    }

    if (taskFinal && finalDate > taskFinal) {
        throw new AppError(
            `A data de fim do item (${finalDate}) não pode ultrapassar a data de fim da tarefa (${taskFinal}).`,
            400
        );
    }
}

module.exports = { parseDate, validateItemDates, toDayKey };
