/**
 * @fileoverview Seleção pura do detalhe de despesa correspondente ao tipo.
 *
 * @module modules/global/domain/gapp/expenses/expense-detail.selector
 */

const { EXPENSE_TYPE_DETAIL_FIELD } = require('./expense-type.enum');

/**
 * @param {object} data - Body da requisição.
 * @returns {object|null} `data[campo]` correspondente ao `exp_type_id_fk`, ou `null` (tipo 6/Outros ou desconhecido).
 */
function pickTypeDetail(data) {
    const field = EXPENSE_TYPE_DETAIL_FIELD[Number(data.exp_type_id_fk)];
    return field ? data[field] : null;
}

module.exports = { pickTypeDetail };
