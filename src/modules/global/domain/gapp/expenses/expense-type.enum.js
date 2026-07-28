/**
 * @fileoverview Enum do campo `exp_type_id_fk` de `gapp_expenses_register`,
 * e o mapeamento pra qual campo do body carrega o detalhe do tipo.
 *
 * @module modules/global/domain/gapp/expenses/expense-type.enum
 */

const ExpenseType = Object.freeze({
    FUEL: 1,
    MAINTENANCE: 2,
    SINISTER: 3,
    FINE: 4,
    INSURANCE: 5,
});

/** Tipo 6 (Outros) não tem tabela de detalhe — não aparece aqui. */
const EXPENSE_TYPE_DETAIL_FIELD = Object.freeze({
    1: 'fuel',
    2: 'maintenance',
    3: 'sinister',
    4: 'fine',
    5: 'insurance',
});

module.exports = { ExpenseType, EXPENSE_TYPE_DETAIL_FIELD };
