/**
 * @fileoverview Repositório Oracle para o módulo BPPP (Busca de Preço Peg Pesé).
 *
 * Migrado de `GLOBAL/DAO/BPPP/Product.php`. Consulta o ERP Consinco para
 * retornar, por loja, o produto com descrição, código de barras, estoque,
 * preço normal e preço promocional.
 *
 * Diferenças em relação ao DAO legado (intencionais):
 * - As 3 consultas encadeadas do legado (código → estoque/descrição → preço)
 *   foram unificadas em uma única query por critério de busca.
 * - Todos os valores de entrada entram por bind variable (o legado concatenava
 *   direto na string SQL).
 * - O preço passou a ser calculado sempre para a loja pedida — na busca por
 *   descrição o legado fixava a loja 1.
 * - `ROWNUM` é aplicado DEPOIS do `ORDER BY` (no legado o limite era aplicado
 *   antes da ordenação, devolvendo um recorte arbitrário).
 *
 * @module modules/global/repositories/oracle/bppp.oracle.queries
 */

const { oracleQuery } = require('../../../../config/oracle');

/** Limite de linhas da busca por descrição (mesmo valor do DAO legado). */
const DESCRIPTION_MAX_ROWS = 25;

/**
 * Códigos de acesso (EAN) por produto, consolidados em uma linha:
 * `COD_NORMAL` (EAN de indústria/interno) e `COD_BALANCA` (código de balança).
 * Só considera códigos próprios (`CGCFORNEC = 0`) e utilizáveis na venda.
 */
const PRODUCT_CODES_SQL = `
    SELECT SEQPRODUTO,
           MAX(CASE WHEN TIPCODIGO IN ('E', 'D') THEN CODACESSO END) AS COD_NORMAL,
           MAX(CASE WHEN TIPCODIGO = 'B'         THEN CODACESSO END) AS COD_BALANCA
      FROM CONSINCO.MAP_PRODCODIGO
     WHERE CGCFORNEC    = 0
       AND TIPCODIGO   IN ('B', 'E', 'D')
       AND INDUTILVENDA = 'S'
     GROUP BY SEQPRODUTO
`;

/**
 * Projeção comum às três buscas. O preço usa `PE.NROEMPRESA` (e não um bind
 * separado) para garantir que preço e estoque sejam sempre da mesma loja.
 */
const BASE_SELECT_SQL = `
    SELECT PE.SEQPRODUTO                                                 AS PLU,
           P.DESCCOMPLETA                                                AS DESCRIPTION,
           COALESCE(COD.COD_NORMAL, COD.COD_BALANCA)                     AS BARCODE,
           PE.ESTQLOJA                                                   AS STORE,
           PE.STATUSCOMPRA                                               AS STATUS,
           CONSINCO.FPRECOEMBPRODUTO(PE.SEQPRODUTO, 1, 1, PE.NROEMPRESA) AS PRICE,
           CONSINCO.FPRECOEMBPROMOC (PE.SEQPRODUTO, 1, 1, PE.NROEMPRESA) AS PRICE_PROMOTION
      FROM CONSINCO.MRL_PRODUTOEMPRESA PE
      JOIN CONSINCO.MAP_PRODUTO        P   ON P.SEQPRODUTO   = PE.SEQPRODUTO
      LEFT JOIN (${PRODUCT_CODES_SQL})  COD ON COD.SEQPRODUTO = PE.SEQPRODUTO
`;

/**
 * Busca um produto pelo PLU (SEQPRODUTO) em uma loja.
 *
 * @param {number} shopId - NROEMPRESA da loja
 * @param {number} plu    - SEQPRODUTO do produto
 * @returns {Promise<object[]>}
 */
async function findByPlu(shopId, plu) {
    return oracleQuery(`
        ${BASE_SELECT_SQL}
         WHERE PE.NROEMPRESA = :shopId
           AND PE.SEQPRODUTO = :plu
    `, { shopId, plu });
}

/**
 * Busca um produto pelo código de barras (CODACESSO) em uma loja.
 *
 * @param {number} shopId - NROEMPRESA da loja
 * @param {string} ean    - Código de barras lido/digitado
 * @returns {Promise<object[]>}
 */
async function findByEan(shopId, ean) {
    return oracleQuery(`
        ${BASE_SELECT_SQL}
         WHERE PE.NROEMPRESA = :shopId
           AND PE.SEQPRODUTO IN (SELECT SEQPRODUTO
                                   FROM CONSINCO.MAP_PRODCODIGO
                                  WHERE CODACESSO  = :ean
                                    AND CGCFORNEC  = 0
                                    AND TIPCODIGO IN ('E', 'B', 'D'))
    `, { shopId, ean });
}

/**
 * Busca produtos pela descrição completa (LIKE) em uma loja.
 * A descrição no Consinco é armazenada em maiúsculas — o termo já deve chegar
 * normalizado e com os curingas (`%TERMO%`).
 *
 * @param {number} shopId  - NROEMPRESA da loja
 * @param {string} pattern - Padrão LIKE já montado (ex: `%FARINHA%`)
 * @param {number} [maxRows=DESCRIPTION_MAX_ROWS]
 * @returns {Promise<object[]>}
 */
async function findByDescription(shopId, pattern, maxRows = DESCRIPTION_MAX_ROWS) {
    return oracleQuery(`
        SELECT * FROM (
            ${BASE_SELECT_SQL}
             WHERE PE.NROEMPRESA   = :shopId
               AND P.DESCCOMPLETA LIKE :pattern
             ORDER BY P.DESCCOMPLETA
        ) WHERE ROWNUM <= :maxRows
    `, { shopId, pattern, maxRows });
}

module.exports = {
    findByPlu,
    findByEan,
    findByDescription,
    DESCRIPTION_MAX_ROWS,
};
