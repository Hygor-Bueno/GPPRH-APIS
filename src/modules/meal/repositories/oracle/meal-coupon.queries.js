/**
 * @fileoverview Queries Oracle puras — cupom fiscal do refeitório.
 *
 * Fonte: `CONSINCO.MFL_DOCTOFISCAL` e `CONSINCO.MFL_DFITEM`. É o único lugar do
 * módulo que sai do SQL Server, e sai porque o Consinco é a autoridade sobre a
 * venda: se o documento não está lá, ele não aconteceu.
 *
 * @module modules/meal/repositories/oracle/meal-coupon.queries
 */

'use strict';

/**
 * Localiza o cupom e, no mesmo golpe, o item de almoço dentro dele.
 *
 * ── Por que a loja entra por `GE_EMPRESA`, e não por `nroempresa` ───────────
 *
 * O cupom fiscal NÃO carrega número de loja — a chave da NFC-e tem CNPJ e mais
 * nada que identifique a filial. E o CNPJ não é o `nroempresa`: são três
 * numerações distintas para a mesma loja (CNPJ na Receita, `nroempresa` no
 * Consinco, `M0_CODFIL` no Protheus).
 *
 * `GE_EMPRESA` já guarda essa correspondência, então o CNPJ do cupom entra
 * direto e o Consinco resolve o `nroempresa` sozinho. A alternativa — manter o
 * `nroempresa` copiado numa tabela nossa — criaria uma cópia que envelhece em
 * silêncio quando o ERP mudar.
 *
 * O CNPJ vem partido em dois porque é assim que a coluna existe: `NROCGC` são
 * os 12 primeiros dígitos e `DIGCGC` os 2 verificadores. Ambos NUMÉRICOS — daí
 * os binds irem como número, não como texto.
 *
 * ── Por que `LEFT JOIN` no item, e não `INNER` ──────────────────────────────
 *
 * A query enviada como referência usa `INNER JOIN`. Com `INNER`, um cupom que
 * existe mas não tem almoço volta zero linhas — exatamente igual a um cupom que
 * não existe. São dois casos que pedem mensagens diferentes no balcão ("esse
 * cupom não tem almoço" e "esse cupom não existe") e, mais importante, têm
 * gravidades diferentes: o segundo é tentativa de fraude e merece registro.
 *
 * Com `LEFT JOIN` o cabeçalho volta sempre, e `SEQPRODUTO` nulo é a resposta
 * "achei a venda, não achei o almoço nela".
 *
 * ── Por que a data é janela e não igualdade ─────────────────────────────────
 *
 * `DTAMOVIMENTO = :hoje` faz o cupom de ontem sumir, e sumir é indistinguível
 * de não existir — o mesmo problema de cima. A janela deixa o documento
 * aparecer para a aplicação comparar a data e responder com precisão, sem
 * abrir mão do índice: `TRUNC(f.DTAMOVIMENTO) = :dia` funcionaria e
 * descartaria o índice, porque a função no lado da coluna impede o seek.
 *
 * ── Tipos dos binds ─────────────────────────────────────────────────────────
 *
 * `:numerodf` e `:seriedf` vão como NÚMERO. A chave da NFC-e traz `000371116`
 * com zeros à esquerda; mandar a string força conversão implícita e descarta o
 * índice do mesmo jeito. `readNfceQr()` já devolve `nNF` convertido.
 *
 * ⚠️ **FALTA A SITUAÇÃO DO DOCUMENTO.** Cupom cancelado ainda passa por esta
 * query, e o caminho de fraude é direto: comprar, guardar o cupom, cancelar a
 * venda no caixa, almoçar. Falta confirmar o nome da coluna de situação em
 * `MFL_DOCTOFISCAL` (e se o cancelamento de item aparece em `MFL_DFITEM`) para
 * acrescentar aqui. Preferi deixar a lacuna visível a inventar um nome de
 * coluna que derrubaria a query com ORA-00904 em produção.
 *
 * @returns {string} SQL com binds nomeados.
 */
function sqlFindCouponMealItem() {
    return `
        SELECT f.NROEMPRESA    AS nroempresa,
               f.SERIEDF       AS seriedf,
               f.NUMERODF      AS numerodf,
               f.DTAMOVIMENTO  AS dtamovimento,
               fi.SEQPRODUTO   AS seqproduto,
               fi.QUANTIDADE   AS quantidade,
               fi.VLRITEM      AS vlritem
          FROM CONSINCO.GE_EMPRESA e
         INNER JOIN CONSINCO.MFL_DOCTOFISCAL f
            ON f.NROEMPRESA = e.NROEMPRESA
          LEFT JOIN CONSINCO.MFL_DFITEM fi
            ON fi.NROEMPRESA = f.NROEMPRESA
           AND fi.SERIEDF    = f.SERIEDF
           AND fi.NUMERODF   = f.NUMERODF
           AND fi.SEQPRODUTO = :seqproduto
         WHERE e.NROCGC        = :nrocgc
           AND e.DIGCGC        = :digcgc
           AND f.SERIEDF       = :seriedf
           AND f.NUMERODF      = :numerodf
           AND f.DTAMOVIMENTO >= :desde
           AND f.DTAMOVIMENTO <  :ate
    `;
}

module.exports = { sqlFindCouponMealItem };
