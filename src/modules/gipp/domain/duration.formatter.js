/**
 * @fileoverview Formatação pura de durações (minutos) em texto legível para
 * descrições de recibo.
 * @module modules/gipp/domain/duration.formatter
 */

/**
 * Formata minutos em string legível.
 * - `null` / `<= 0` → `null` (item omitido da descrição)
 * - `< 60`          → `"Xm"` (ex.: `"45 min"`)
 * - múltiplo de 60  → `"Xh"` (ex.: `"8 h"`)
 * - demais          → `"XhYm"` (ex.: `"5h40m"`)
 * @param {number|null} min
 * @returns {string|null}
 */
function formatMinutes(min) {
    if (!min || min <= 0) return null;
    if (min < 60) return `${min} min`;
    if (min % 60 === 0) return `${Math.floor(min / 60)} h`;
    return `${Math.floor(min / 60)}h${min % 60}m`;
}

module.exports = { formatMinutes };
