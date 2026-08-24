/**
 * @fileoverview Cálculo puro do detalhe de abastecimento (fuel).
 *
 * @module modules/global/domain/gapp/expenses/fuel-detail.calculator
 */

/**
 * Se `detail.liter_value` não vier, calcula como total_value da despesa ÷
 * liter_qtd — assume que total_value representa só o valor do combustível.
 * Se já vier preenchido, usa o valor enviado sem alterar. Se não for
 * possível calcular (sem liter_qtd/total_value válidos), devolve como veio
 * — o banco recusa com erro claro de NOT NULL.
 *
 * @param {object} detail
 * @param {number} totalValue
 * @returns {object}
 */
function resolveFuelDetail(detail, totalValue) {
    if (detail.liter_value != null) return detail;

    const literQtd = Number(detail.liter_qtd);
    const total = Number(totalValue);
    if (!literQtd || !Number.isFinite(total)) return detail;

    return { ...detail, liter_value: total / literQtd };
}

module.exports = { resolveFuelDetail };
