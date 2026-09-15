/**
 * @fileoverview Normalização de paginação, comum a todas as listagens do miepp.
 *
 * Puro. Existe para que `limit`/`offset` cheguem ao SQL sempre como inteiros
 * dentro de uma faixa conhecida — `LIMIT ?` com string vinda da query string é
 * o caminho mais curto para um erro de sintaxe do MySQL em produção.
 *
 * @module modules/global/domain/miepp/pagination.rules
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * @param {object} query - normalmente `req.query`.
 * @returns {{limit: number, offset: number, page: number}}
 */
function normalizePagination(query = {}) {
    const rawLimit = Number(query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.trunc(rawLimit), MAX_LIMIT)
        : DEFAULT_LIMIT;

    // `page` tem precedência sobre `offset` quando ambos vêm — é o que o painel
    // usa; `offset` fica para chamadas manuais.
    const rawPage = Number(query.page);
    if (Number.isFinite(rawPage) && rawPage >= 1) {
        const page = Math.trunc(rawPage);
        return { limit, offset: (page - 1) * limit, page };
    }

    const rawOffset = Number(query.offset);
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.trunc(rawOffset) : 0;

    return { limit, offset, page: Math.floor(offset / limit) + 1 };
}

/**
 * Filtro booleano opcional vindo da query string (`?active=1`).
 *
 * Devolve `null` quando o parâmetro não veio — as queries usam
 * `(? IS NULL OR coluna = ?)`, então `null` significa "sem filtro", e não
 * "inativo".
 *
 * @param {*} value
 * @returns {0|1|null}
 */
function optionalFlag(value) {
    if (value === undefined || value === null || value === '') return null;
    if (value === true || value === 1 || value === '1' || value === 'true') return 1;
    if (value === false || value === 0 || value === '0' || value === 'false') return 0;
    return null;
}

/**
 * Envelope de listagem paginada, igual em todas as rotas do módulo.
 *
 * @param {object[]} rows
 * @param {number}   total
 * @param {{limit: number, offset: number, page: number}} pagination
 * @returns {{items: object[], pagination: object}}
 */
function paginated(rows, total, { limit, offset, page }) {
    return {
        items: rows,
        pagination: {
            total: Number(total) || 0,
            limit,
            offset,
            page,
            pages: limit > 0 ? Math.ceil((Number(total) || 0) / limit) : 0,
        },
    };
}

module.exports = { DEFAULT_LIMIT, MAX_LIMIT, normalizePagination, optionalFlag, paginated };
