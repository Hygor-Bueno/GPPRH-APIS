/**
 * @fileoverview Repositório Oracle para o módulo EPP.
 *
 * Acessa tabelas do ERP Consinco para:
 * - Buscar descrições de produtos (DIM_PRODUTO)
 * - Buscar preços por loja (MRL_PRODEMPSEG)
 * - Buscar receitas/fichas técnicas (MRL_RECEITARENDTO)
 *
 * IDs usados nas cláusulas IN vêm exclusivamente do banco MySQL interno —
 * não de input do usuário — por isso o buildIntList é seguro aqui.
 *
 * @module modules/global/repositories/oracle/epp.oracle.repository
 */

const { oracleQuery, buildIntList } = require('../../../../config/oracle');

// SQL da receita técnica — reutilizado em múltiplas funções
const RECEIPE_SQL = `
    SELECT
        D.SEQRECEITARENDTO  AS COD_RECEITA,
        D.RECEITARENDTO     AS NOME_RECEITA,
        B.SEQPRODUTO        AS COD_PROD_MAT_PRIMA,
        B.DESCCOMPLETA      AS DESCRICAO_MAT_PRIMA,
        Z.SEQPRODUTO        AS COD_PROD_FINAL,
        DECODE(D.STATUSRECRENDTO, 'A', 'ATIVO', 'I', 'INATIVO') AS STATUS,
        C.QTDUNIDUTILIZADA,
        B.INDPROCFABRICACAO
    FROM consinco.mrl_produtoempresa  A,
         consinco.map_produto          B,
         consinco.mrl_rrcomponente     C,
         consinco.mrl_receitarendto    D,
         consinco.mrl_rrprodutofinal   Z
    WHERE A.NROEMPRESA          = 1
      AND D.SEQRECEITARENDTO    = Z.SEQRECEITARENDTO
      AND A.SEQPRODUTO          = B.SEQPRODUTO
      AND B.SEQPRODUTO          = C.SEQPRODUTO
      AND C.SEQRECEITARENDTO    = D.SEQRECEITARENDTO
      AND D.STATUSRECRENDTO     = 'A'
      AND B.INDPROCFABRICACAO  != 'I'
`;

/**
 * Busca descrições de produtos no Consinco por lista de IDs (SEQPRODUTO).
 *
 * @param {number[]} seqProdutos - IDs de produto do Consinco
 * @returns {Promise<object[]>} [{ SEQPRODUTO, PRODUTO }]
 */
async function getProductDescriptions(seqProdutos) {
    const list = buildIntList(seqProdutos);
    return oracleQuery(
        `SELECT SEQPRODUTO, PRODUTO FROM CONSINCODW.DIM_PRODUTO WHERE SEQPRODUTO IN (${list})`
    );
}

/**
 * Busca informações de produto(s) no Consinco por código de barras (CODACESSO).
 * Retorna preço, status de venda, empresa, etc.
 *
 * @param {string}   codigoAcesso - Código de barras do produto
 * @param {string}   lojas        - Ex: "1,2,3" ou um ID de loja
 * @returns {Promise<object[]>}
 */
async function getProductConsinco(codigoAcesso, lojas) {
    // Lojas são números vindos do nosso sistema (não input do usuário direto)
    // Validar que são apenas dígitos e vírgulas
    if (!/^[\d,\s]+$/.test(String(lojas))) {
        throw new Error('getProductConsinco: valor inválido para lojas');
    }
    return oracleQuery(`
        SELECT
            A.SEQPRODUTO,
            A.NROEMPRESA,
            P.EMPRESA,
            B.DESCCOMPLETA,
            B.DESCREDUZIDA,
            C.CODACESSO,
            C.TIPCODIGO,
            DECODE(MIN(STATUSVENDA), 'A', MIN(STATUSVENDA), 'I') AS STATUSVENDA,
            MAX(
                CASE
                    WHEN DECODE(A.PRECOVALIDPROMOC, 0, A.PRECOVALIDNORMAL, A.PRECOVALIDPROMOC) = 0
                    THEN NULL
                    ELSE (DECODE(A.PRECOVALIDPROMOC, 0, A.PRECOVALIDNORMAL, A.PRECOVALIDPROMOC) / A.QTDEMBALAGEM)
                END
            ) AS PRECO
        FROM CONSINCO.MRL_PRODEMPSEG A
        INNER JOIN CONSINCO.MAP_PRODUTO      B ON A.SEQPRODUTO = B.SEQPRODUTO
        INNER JOIN CONSINCO.MAP_PRODCODIGO   C ON A.SEQPRODUTO = C.SEQPRODUTO
        INNER JOIN CONSINCODW.DIM_EMPRESA    P ON A.NROEMPRESA = P.NROEMPRESA
        WHERE A.NROEMPRESA IN (${lojas})
          AND C.TIPCODIGO   = 'B'
          AND A.NROSEGMENTO = '1'
          AND C.CODACESSO   = :codigoAcesso
        GROUP BY
            A.SEQPRODUTO, A.NROEMPRESA, P.EMPRESA,
            B.DESCCOMPLETA, B.DESCREDUZIDA, C.CODACESSO, C.TIPCODIGO
    `, { codigoAcesso });
}

/**
 * Busca a receita técnica de um produto final específico.
 *
 * @param {number} seqProduto - SEQPRODUTO do produto final
 * @returns {Promise<object[]>}
 */
async function getReceipeByProduct(seqProduto) {
    return oracleQuery(`
        ${RECEIPE_SQL}
          AND Z.SEQPRODUTO = :seqProduto
        ORDER BY D.RECEITARENDTO, B.DESCCOMPLETA
    `, { seqProduto });
}

/**
 * Busca receitas técnicas de múltiplos produtos finais.
 *
 * @param {number[]} seqProdutos - Lista de SEQPRODUTO dos produtos finais
 * @returns {Promise<object[]>}
 */
async function getReceipeByProducts(seqProdutos) {
    const list = buildIntList(seqProdutos);
    return oracleQuery(`
        ${RECEIPE_SQL}
          AND Z.SEQPRODUTO IN (${list})
        ORDER BY D.RECEITARENDTO, B.DESCCOMPLETA
    `);
}

/**
 * Busca a quantidade de matéria-prima derivada de menus pendentes de entrega
 * para um produto de matéria-prima específico.
 *
 * Combina: menusAtivos (do MySQL, passados como parâmetro) × receita Oracle.
 *
 * @param {number}   seqRawMaterial - SEQPRODUTO da matéria-prima
 * @param {number[]} menuProductIds - IDs dos produtos de menu com pedidos pendentes
 * @returns {Promise<number>} Quantidade total derivada dos menus
 */
async function getRawMaterialQtyFromMenus(seqRawMaterial, menuProductIds) {
    if (!menuProductIds.length) return 0;

    const list = buildIntList(menuProductIds);
    const rows = await oracleQuery(`
        ${RECEIPE_SQL}
          AND Z.SEQPRODUTO IN (${list})
          AND B.SEQPRODUTO = :seqRawMaterial
        ORDER BY D.RECEITARENDTO, B.DESCCOMPLETA
    `, { seqRawMaterial });

    return rows; // O cálculo final (× quantidade de cada menu) é feito no serviço
}

async function getEcommerceOrder(nroPedido) {
    return oracleQuery(`
        SELECT DISTINCT C.DTAINCLUSAO,
                        C.NROPEDIDOAFV,
                        B.SEQPRODUTO,
                        (SELECT A.DESCCOMPLETA
                           FROM CONSINCO.MAP_PRODUTO A
                          WHERE A.SEQPRODUTO = B.SEQPRODUTO) DESCRICAO,
                        b.qtdatendida / b.qtdembalagem                              QUANTIDADE,
                        ROUND(b.vlrembinformado, 2)                                 VALOR_UN_CONSINCO,
                        ROUND(SUM(b.qtdatendida / b.qtdembalagem * b.vlrembinformado), 2) VALOR_CONSINCO,
                        C.USUINCLUSAO,
                        D.SEQPESSOA  COD_CLIENTE,
                        RTRIM(D.NOMERAZAO) NOME_CLIENTE,
                        D.FONENRO1,
                        D.EMAIL
          FROM CONSINCO.MAD_PEDVENDAITEM B,
               CONSINCO.MAD_PEDVENDA     C,
               CONSINCO.GE_PESSOA        D
         WHERE C.NROPEDIDOAFV = :nroPedido
           AND C.NROPEDVENDA  = B.NROPEDVENDA
           AND C.SEQPESSOA    = D.SEQPESSOA
         GROUP BY C.NROPEDIDOAFV,
                  C.SITUACAOPED,
                  C.USUINCLUSAO,
                  D.SEQPESSOA,
                  D.NOMERAZAO,
                  C.DTAINCLUSAO,
                  B.SEQPRODUTO,
                  D.FONENRO1,
                  D.EMAIL,
                  b.qtdatendida,
                  b.qtdembalagem,
                  b.vlrembinformado
         ORDER BY C.DTAINCLUSAO, C.NROPEDIDOAFV, B.SEQPRODUTO
    `, { nroPedido });
}

module.exports = {
    getProductDescriptions,
    getProductConsinco,
    getReceipeByProduct,
    getReceipeByProducts,
    getRawMaterialQtyFromMenus,
    getEcommerceOrder,
};
