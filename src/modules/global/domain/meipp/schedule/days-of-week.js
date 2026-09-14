/**
 * @fileoverview Bitmask de dias da semana de `meipp_schedules.days_of_week`.
 *
 * Convenção do schema: bit0 = domingo … bit6 = sábado, portanto o bit é
 * exatamente o `Date#getDay()` do JavaScript (0 = domingo). 127 (0b1111111) é
 * "todos os dias" e é o DEFAULT da coluna.
 *
 * @module modules/global/domain/meipp/schedule/days-of-week
 */

/** Todos os sete bits ligados — valor DEFAULT da coluna. */
const ALL_DAYS = 0b1111111; // 127

/** Rótulos por bit, na ordem do bitmask (índice = bit = Date#getDay()). */
const DAY_LABELS = Object.freeze(['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']);

/**
 * O bitmask cobre o dia informado?
 *
 * @param {number} mask     - `meipp_schedules.days_of_week` (0–127).
 * @param {number} weekday  - 0 (domingo) a 6 (sábado), como `Date#getDay()`.
 * @returns {boolean}
 */
function coversWeekday(mask, weekday) {
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return false;
    const bits = Number(mask);
    if (!Number.isFinite(bits)) return false;
    return (bits & (1 << weekday)) !== 0;
}

/**
 * Expande o bitmask em rótulos legíveis — usado só para exibir o agendamento
 * no painel, nunca na decisão de tocar.
 *
 * @param {number} mask
 * @returns {string[]} ex.: `['seg', 'ter', 'qua', 'qui', 'sex']`
 */
function toLabels(mask) {
    return DAY_LABELS.filter((_, weekday) => coversWeekday(mask, weekday));
}

/**
 * Monta o bitmask a partir de uma lista de dias (0–6). Aceita a lista vazia
 * como "nenhum dia" (0), que na prática desliga o agendamento sem mexer no
 * `active` — é responsabilidade do schema de validação decidir se isso é
 * aceitável no payload.
 *
 * @param {number[]} weekdays
 * @returns {number}
 */
function fromWeekdays(weekdays = []) {
    return weekdays.reduce((mask, weekday) => {
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return mask;
        return mask | (1 << weekday);
    }, 0);
}

module.exports = { ALL_DAYS, DAY_LABELS, coversWeekday, toLabels, fromWeekdays };
