/**
 * @fileoverview Resolução dos produtos de uma grade no Consinco.
 *
 * É a ÚNICA leitura de produto do renderizador, e roda uma vez por ciclo por
 * grade — nunca por exibição. Uma query resolve os até 36 PLUs da grade de uma
 * vez; 36 consultas separadas multiplicariam por 36 o tráfego num pool Oracle
 * de `poolMax: 5` por processo.
 *
 * Reusa `PRODUCT_CODES_SQL` e `ACTIVE_FOR_SALE_SQL` do BPPP: é a mesma
 * definição de código de acesso e de "ativo para venda" que a busca de preço
 * usa. Se um dia o ERP mudar a regra, muda num lugar só.
 *
 * @module modules/global/repositories/oracle/miepp-product-grid.oracle.queries
 */

const { oracleQuery } = require('../../../../config/oracle');
const { PRODUCT_CODES_SQL, ACTIVE_FOR_SALE_SQL } = require('./bppp.oracle.queries');

/**
 * Teto de PLUs por consulta. A grade comporta no máximo 6x6 = 36, e o `IN` do
 * Oracle aceita 1000 — a constante existe para que um chamador futuro não
 * esbarre no limite sem aviso.
 */
const MAX_PLUS_PER_QUERY = 100;

/**
 * Produtos ATIVOS de uma loja, entre os PLUs informados.
 *
 * Devolve só o que está ativo para venda. PLU inativo, inexistente ou de outra
 * loja simplesmente não volta — e é o chamador que decide o que fazer com a
 * ausência. Hoje a regra é tirar a grade inteira do ar (ver
 * `grid-render.rules`), o que só é possível porque a ausência chega como
 * ausência, e não como uma linha com preço zerado.
 *
 * Cada PLU entra como bind nomeado (`:p0`, `:p1`, …). Interpolar a lista na
 * string mataria o cache de plano do Oracle e abriria injeção — os valores vêm
 * do banco, mas "vem do banco" não é garantia que sobreviva a um import futuro.
 *
 * @param {number}   shopId - CONSINCO.NROEMPRESA
 * @param {number[]} plus   - SEQPRODUTO dos itens da grade
 * @returns {Promise<object[]>} `[{PLU, DESCRIPTION, BARCODE, PRICE, PRICE_PROMOTION}]`
 */
async function findActiveProductsByPlus(shopId, plus = []) {
    if (!Array.isArray(plus) || plus.length === 0) return [];

    const wanted = plus.slice(0, MAX_PLUS_PER_QUERY);
    const binds = { shopId };
    const placeholders = wanted.map((plu, index) => {
        binds[`p${index}`] = Number(plu);
        return `:p${index}`;
    });

    return oracleQuery(`
        SELECT PE.SEQPRODUTO                                                 AS PLU,
               P.DESCCOMPLETA                                                AS DESCRIPTION,
               COALESCE(COD.COD_NORMAL, COD.COD_BALANCA)                     AS BARCODE,
               CONSINCO.FPRECOEMBPRODUTO(PE.SEQPRODUTO, 1, 1, PE.NROEMPRESA) AS PRICE,
               CONSINCO.FPRECOEMBPROMOC (PE.SEQPRODUTO, 1, 1, PE.NROEMPRESA) AS PRICE_PROMOTION
          FROM CONSINCO.MRL_PRODUTOEMPRESA PE
          JOIN CONSINCO.MAP_PRODUTO        P   ON P.SEQPRODUTO   = PE.SEQPRODUTO
          LEFT JOIN (${PRODUCT_CODES_SQL})  COD ON COD.SEQPRODUTO = PE.SEQPRODUTO
         WHERE PE.NROEMPRESA = :shopId
           AND PE.SEQPRODUTO IN (${placeholders.join(', ')})
           AND ${ACTIVE_FOR_SALE_SQL}
    `, binds);
}

module.exports = { findActiveProductsByPlus, MAX_PLUS_PER_QUERY };
