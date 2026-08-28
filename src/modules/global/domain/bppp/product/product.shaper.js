/**
 * @fileoverview Lógica pura de formatação do produto BPPP — converte a linha
 * crua do Oracle no contrato consumido pelo app (mesmas chaves do PHP legado).
 *
 * @module modules/global/domain/bppp/product/product.shaper
 */

/** Formata um valor monetário como string com 2 decimais (igual `number_format`). */
function toMoney(value) {
    return Number(value || 0).toFixed(2);
}

/**
 * Converte uma linha do Consinco no produto da resposta.
 *
 * `promotion` é 1 quando existe preço promocional válido (> 0), replicando a
 * regra do DAO legado. `price_promotion` é um campo novo (aditivo) para o
 * front poder exibir os dois valores sem uma segunda chamada.
 *
 * @param {object} row - Linha retornada pelas queries de `bppp.oracle.queries`
 * @returns {{plu:number, description:?string, barcode:?string, store:number,
 *            price:string, price_promotion:?string, promotion:0|1, status:?string}}
 */
function toProduct(row) {
    const promotionPrice = Number(row.PRICE_PROMOTION || 0);

    return {
        plu:             Number(row.PLU),
        description:     row.DESCRIPTION ?? null,
        barcode:         row.BARCODE != null ? String(row.BARCODE) : null,
        store:           Number(row.STORE || 0),
        price:           toMoney(row.PRICE),
        price_promotion: promotionPrice > 0 ? toMoney(promotionPrice) : null,
        promotion:       promotionPrice > 0 ? 1 : 0,
        status:          row.STATUS ?? null,
    };
}

/**
 * Converte a lista de linhas do Oracle na lista de produtos da resposta.
 * @param {object[]} rows
 */
function toProductList(rows) {
    return rows.map(toProduct);
}

module.exports = { toProduct, toProductList };
