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

    /**
     * As linhas já gravadas, com recorte.
     *
     * Quem chama já validou o recorte: ou `nfeKey`, ou o par de datas. A
     * implementação não confere de novo — o motivo do recorte é o índice, e
     * quem conhece o índice é o adapter, mas quem conhece a regra é o caso de
     * uso.
     *
     * @param {{nfeKey: ?string, dateFrom: ?string, dateTo: ?string,
     *          siteCode: ?string, limit: number, offset: number}} filters
     * @returns {Promise<{rows: object[], total: number}>}
     */
    listCoupons(filters) { throw new Error('Not implemented'); }

    /**
     * Uma linha, pelo id. `null` quando não existe.
     * @param {number} id
     * @returns {Promise<?object>}
     */
    getCouponById(id) { throw new Error('Not implemented'); }

    /**
     * Estorna um resgate: apaga a linha de saldo, a refeição que ela gerou, e
     * fecha o buraco na sequência — tudo numa transação só.
     *
     * As três etapas são indivisíveis pelo mesmo motivo que o resgate é: apagar
     * o saldo sem apagar a refeição conta um almoço que ninguém pagou; apagar a
     * refeição sem apagar o saldo prende o saldo de um cupom que não foi
     * servido; e deixar o buraco na sequência trava o saldo restante (ver
     * `sqlResequenceCouponAfterDelete`).
     *
     * @param {number} id
     * @returns {Promise<?{coupon: object, meal_log_deleted: boolean}>}
     *          `null` quando o id não existe — quem chamou transforma em 404.
     */
    deleteCouponById(id) { throw new Error('Not implemented'); }
}

module.exports = { MealCouponRepositoryPort };
