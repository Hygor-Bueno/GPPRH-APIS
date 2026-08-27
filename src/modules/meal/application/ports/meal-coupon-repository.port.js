/**
 * @fileoverview Porta (contrato) de persistência — cupom fiscal do refeitório.
 *
 * Duas fontes atrás de um contrato só: o Consinco (Oracle) diz se a venda
 * existe, o GIPP (SQL Server) diz quanto do cupom já foi consumido. O caso de
 * uso não sabe que são bancos diferentes, e é isso que torna ele testável sem
 * nenhum dos dois.
 *
 * @module modules/meal/application/ports/meal-coupon-repository.port
 */

class MealCouponRepositoryPort {
    /**
     * De qual FILIAL do Protheus é este CNPJ?
     *
     * Lê o cadastro de filiais direto (`SYS_COMPANY`); não há tabela própria de
     * lojas. O `nroempresa` do Consinco também não é guardado do nosso lado —
     * `GE_EMPRESA` casa o CNPJ com ele na query do cupom.
     *
     * `null` significa que o CNPJ não é do grupo.
     *
     * @param {string} cnpj - 14 dígitos, sem máscara.
     * @returns {Promise<?{cnpj: string, site_code: string, label: string}>}
     */
    findPosSiteByCnpj(cnpj) { throw new Error('Not implemented'); }

    /**
     * A venda existe no Consinco, e tem o item de almoço?
     *
     * Entra pelo CNPJ, não pelo `nroempresa`: o cupom não carrega número de
     * loja, e `GE_EMPRESA` faz a tradução dentro do próprio ERP.
     *
     * O item vem por `LEFT JOIN`: `seqproduto` nulo significa "achei a venda,
     * não achei o almoço nela", que é diferente de não achar nada.
     *
     * @param {{cnpj: string, serie: string, numerodf: number,
     *          seqproduto: number, from: Date, to: Date}} query
     * @returns {Promise<?{nroempresa: number, dtamovimento: Date,
     *                     seqproduto: ?number, quantidade: ?number, vlritem: ?number}>}
     */
    findCouponInConsinco(query) { throw new Error('Not implemented'); }

    /**
     * Quanto deste cupom já foi consumido.
     * @param {string} nfeKey
     * @returns {Promise<?{meals_authorized: number, meals_redeemed: number,
     *                     site_code: string, coupon_date: Date, tp_emis: string}>}
     *          `null` quando o cupom nunca foi usado.
     */
    getCouponBalance(nfeKey) { throw new Error('Not implemented'); }

    /**
     * Consome uma refeição do cupom E grava a refeição, numa transação só.
     *
     * Indivisível de propósito. Gravar a refeição sem consumir o saldo libera
     * almoço de graça; consumir sem gravar cobra do cupom uma refeição que
     * ninguém comeu. A linha de saldo entra PRIMEIRO porque é o recurso escasso
     * — se ela falhar, nada mais aconteceu.
     *
     * @param {object} coupon    - Campos de `meal_coupon`.
     * @param {object} mealLog   - Campos de `meal_log`.
     * @returns {Promise<{coupon: object, log: object}>}
     * @throws {AppError} 409 quando o saldo acabou entre a conferência e o resgate.
     */
    redeemCouponWithMealLog(coupon, mealLog) { throw new Error('Not implemented'); }
}

module.exports = { MealCouponRepositoryPort };
