/**
 * @fileoverview Regra pura: percentual decorrido do prazo de um item GTPP.
 *
 * O SQL (`SQL_GET_TASK_ITEMS`) já calcula o percentual por dias, mas devolve
 * NULL para o item de um dia só (`initial_date = final_date`), por causa do
 * `NULLIF(DATEDIFF(...), 0)`. Só esse caso é resolvido aqui, por hora do dia.
 *
 * O valor do SQL vem como string (DECIMAL no mysql2, ex.: `"0"`) e é
 * repassado como veio, para não mudar o contrato dos itens de vários dias.
 *
 * @module modules/global/domain/gtpp/task-item/item-deadline-percent.rules
 */

'use strict';

const { toDayKey } = require('./item-dates.validator');

/**
 * @param {string|number|null} sqlPercent - `deadline_percent` vindo do SQL.
 * @param {Date|string|null} initialDate
 * @param {Date|string|null} finalDate
 * @param {Date} [now]
 * @returns {string|number|null} `null` quando o item não tem prazo.
 */
function computeDeadlinePercent(sqlPercent, initialDate, finalDate, now = new Date()) {
    if (initialDate == null || finalDate == null) return null;
    if (sqlPercent != null) return sqlPercent;

    // Item de um dia só: antes do dia 0%, depois 100%, no dia pela hora.
    const day = toDayKey(finalDate);
    const today = toDayKey(now);
    if (today < day) return 0;
    if (today > day) return 100;
    return Math.round((now.getHours() / 24) * 100);
}

module.exports = { computeDeadlinePercent };
