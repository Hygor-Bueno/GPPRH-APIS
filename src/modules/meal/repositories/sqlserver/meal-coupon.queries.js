/**
 * @fileoverview Queries SQL Server puras — cupom fiscal do refeitório.
 * @module modules/meal/repositories/sqlserver/meal-coupon.queries
 */

'use strict';

/**
 * De qual FILIAL do Protheus é este CNPJ?
 *
 * ── Zero cadastro próprio ───────────────────────────────────────────────────
 *
 * O cupom fiscal não carrega número de loja: a chave da NFC-e tem CNPJ e nada
 * mais. As duas traduções necessárias já existem nos sistemas de origem, e
 * nenhuma é copiada para cá:
 *
 *   CNPJ → M0_CODFIL   `TMPPRD12.dbo.SYS_COMPANY`, esta consulta
 *   CNPJ → NROEMPRESA  `CONSINCO.GE_EMPRESA`, na query do cupom
 *
 * Não existe tabela de lojas habilitadas, e não é esquecimento: um interruptor
 * por filial seria o quarto controle a barrar o mesmo caso. Loja que não vende
 * o produto do almoço já é barrada porque o item não aparece no cupom; cupom de
 * outra loja já é barrado na comparação com a loja da sessão; e quem pode servir
 * já é decidido pela permissão `MEAL_SERVE`. Cadastro que só duplica controle
 * existente é cadastro que alguém vai esquecer de atualizar.
 *
 * Nada encontrado aqui significa que o CNPJ não é do grupo — cupom de
 * concorrente, ou de outra empresa. É recusa legítima, e o caso de uso a
 * distingue das demais.
 *
 * O `REPLACE` triplo existe porque `M0_CGC` pode vir com máscara dependendo de
 * como a filial foi cadastrada, e a chave da NFC-e é numérica pura. Custa uma
 * varredura numa tabela de algumas dezenas de linhas — irrelevante, e é o preço
 * de não depender de o cadastro estar formatado igual em todas as filiais.
 */
function sqlFindPosSiteByCnpj() {
    return `
        SELECT TOP (1)
               LTRIM(RTRIM(c.M0_CODFIL)) AS site_code,
               LTRIM(RTRIM(c.M0_FILIAL)) AS label
        FROM TMPPRD12.dbo.SYS_COMPANY c
        WHERE REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(c.M0_CGC)), '.', ''), '/', ''), '-', '') = @cnpj
          AND c.D_E_L_E_T_ <> '*'
        -- Matriz e filial podem compartilhar CNPJ em algumas instalações do
        -- Protheus. Ordenar torna a escolha determinística em vez de depender da
        -- ordem física das linhas.
        ORDER BY c.M0_CODFIL;
    `;
}

/**
 * Saldo do cupom.
 *
 * `meals_authorized` sai da PRIMEIRA linha gravada e não do maior valor: é o
 * número concedido no primeiro resgate, e ele não muda depois. Se o Consinco
 * mudar a quantidade no meio da fila, o saldo já concedido não pode encolher
 * com gente esperando.
 *
 * Zero linhas significa cupom nunca usado — não significa cupom inválido.
 */
function sqlGetCouponBalance() {
    return `
        SELECT TOP (1)
               c.nfe_key,
               c.meals_authorized,
               (SELECT COUNT_BIG(*) FROM GIPP.dbo.meal_coupon x
                 WHERE x.nfe_key = @nfe_key)          AS meals_redeemed,
               c.site_code,
               c.coupon_date,
               c.seqproduto,
               c.tp_emis,
               c.redeemed_at                          AS first_redeemed_at
        FROM GIPP.dbo.meal_coupon c
        WHERE c.nfe_key = @nfe_key
        ORDER BY c.seq ASC;
    `;
}

/**
 * Consome uma refeição do cupom.
 *
 * ── O `WITH (UPDLOCK, HOLDLOCK)` é o mecanismo, não enfeite ─────────────────
 *
 * Dois terminais lendo o mesmo QR no mesmo instante calculam o mesmo
 * `MAX(seq) + 1`. Sem o lock de faixa, os dois montam `seq = 1` e um recebe
 * violação de unicidade — funciona, mas custa um erro e um retry por corrida.
 * Com `UPDLOCK, HOLDLOCK` sobre `IX_meal_coupon_key`, o segundo espera o
 * primeiro terminar e já calcula `seq = 2`. O índice único continua sendo a
 * garantia final; o lock só evita que ela seja acionada o tempo todo.
 *
 * `CK_meal_coupon_seq` (`seq <= meals_authorized`) recusa a refeição além do
 * saldo no próprio banco. O caso de uso confere antes para dar mensagem
 * decente, mas quem garante é a constraint.
 */
function sqlRedeemCoupon() {
    return `
        INSERT INTO GIPP.dbo.meal_coupon (
            nfe_key, seq, meals_authorized, site_code,
            coupon_date, service_date, seqproduto, tp_emis,
            operator_user_id, redeemed_at
        )
        OUTPUT INSERTED.id, INSERTED.seq, INSERTED.meals_authorized
        SELECT @nfe_key,
               ISNULL(MAX(c.seq), 0) + 1,
               @meals_authorized, @site_code,
               @coupon_date, @service_date, @seqproduto, @tp_emis,
               @operator_user_id,
               /* Vem da aplicação, NÃO do DEFAULT SYSDATETIME() da coluna. O
                  default usava o relógio do SQL Server (horário local) enquanto
                  meal_log.served_at vem do Node (UTC, porque o container não
                  define TZ) — o mesmo resgate ficava gravado com três horas de
                  diferença entre as duas tabelas. Um relógio só para o par. */
               @redeemed_at
        FROM GIPP.dbo.meal_coupon c WITH (UPDLOCK, HOLDLOCK)
        WHERE c.nfe_key = @nfe_key;
    `;
}

/** Amarra a linha de saldo à refeição, depois que o meal_log ganhou id. */
function sqlLinkCouponToMealLog() {
    return `
        UPDATE GIPP.dbo.meal_coupon
        SET meal_log_id = @meal_log_id
        WHERE id = @id;
    `;
}

/**
 * Consulta das linhas já gravadas — a tela de conferência, e a de estorno.
 *
 * Os filtros são todos opcionais NA QUERY e não na rota: o caso de uso é que
 * exige recorte (chave OU período), e a query só precisa saber montar as três
 * combinações. O padrão `@x IS NULL OR coluna = @x` mantém um plano só.
 *
 * `IX_meal_coupon_rpt` é (`service_date`, `site_code`), então a busca com
 * período é seek. A busca por chave usa `IX_meal_coupon_key`. Sem nenhum dos
 * dois seria varredura da tabela inteira — é por isso que o caso de uso obriga
 * um recorte, e não por gosto de formulário.
 *
 * `COUNT_BIG(*) OVER ()` devolve o total do filtro em cada linha, para a tela
 * paginar sem uma segunda consulta.
 */
function sqlListCoupons() {
    return `
        SELECT c.id,
               c.nfe_key,
               c.seq,
               c.meals_authorized,
               c.site_code,
               c.coupon_date,
               c.service_date,
               c.seqproduto,
               c.tp_emis,
               c.meal_log_id,
               c.operator_user_id,
               c.redeemed_at,
               COUNT_BIG(*) OVER ()                    AS total_rows
        FROM GIPP.dbo.meal_coupon c
        WHERE (@nfe_key   IS NULL OR c.nfe_key      = @nfe_key)
          AND (@date_from IS NULL OR c.service_date >= @date_from)
          AND (@date_to   IS NULL OR c.service_date <= @date_to)
          AND (@site_code IS NULL OR c.site_code     = @site_code)
        -- O id no fim do ORDER BY evita a paginação embaralhar quando duas
        -- refeições do mesmo cupom caem no mesmo segundo: redeemed_at é
        -- DATETIME2(0), e isso acontece na fila do almoço.
        ORDER BY c.service_date DESC, c.redeemed_at DESC, c.id DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
    `;
}

/** Uma linha, pelo id. Usada antes do estorno para dizer o que será apagado. */
function sqlGetCouponById() {
    return `
        SELECT TOP (1)
               c.id,
               c.nfe_key,
               c.seq,
               c.meals_authorized,
               c.site_code,
               c.coupon_date,
               c.service_date,
               c.seqproduto,
               c.tp_emis,
               c.meal_log_id,
               c.operator_user_id,
               c.redeemed_at
        FROM GIPP.dbo.meal_coupon c
        WHERE c.id = @id;
    `;
}

/**
 * Apaga a linha de saldo e devolve o que apagou.
 *
 * DELETE de verdade, e não `is_active = 0` como no `diner_group`: a tabela não
 * tem coluna de estado, e não pode ter. O saldo é contado por LINHA
 * (`COUNT(*)` em `sqlGetCouponBalance`) e a unicidade é (`nfe_key`, `seq`) —
 * uma linha "inativa" continuaria ocupando a sequência e segurando o saldo, que
 * é justamente o que o estorno existe para devolver.
 *
 * O `OUTPUT` é o que diz se havia linha: zero linhas devolvidas significa id
 * inexistente, e quem chamou transforma isso em 404 sem precisar de um SELECT
 * anterior.
 */
function sqlDeleteCouponById() {
    return `
        DELETE FROM GIPP.dbo.meal_coupon
        OUTPUT DELETED.id,
               DELETED.nfe_key,
               DELETED.seq,
               DELETED.meals_authorized,
               DELETED.site_code,
               DELETED.coupon_date,
               DELETED.service_date,
               DELETED.seqproduto,
               DELETED.tp_emis,
               DELETED.meal_log_id,
               DELETED.operator_user_id,
               DELETED.redeemed_at
        WHERE id = @id;
    `;
}

/**
 * Fecha o buraco deixado na sequência.
 *
 * ⚠️ Sem isto, apagar uma linha do MEIO cria um cupom com saldo que ninguém
 *   consegue usar, e o erro aparece como mensagem errada e não como erro. Motivo:
 *   `sqlGetCouponBalance` conta LINHAS, mas `sqlRedeemCoupon` grava
 *   `MAX(seq) + 1`. Num cupom de 3 com o seq 1 apagado sobram 2 linhas (seq 2 e
 *   3): a validação diz "resta 1", o resgate tenta gravar seq 4, e
 *   `CK_meal_coupon_seq` (`seq <= meals_authorized`) recusa — o operador lê
 *   "esse cupom acabou de ser usado em outro terminal" olhando para um cupom com
 *   saldo. Reenumerar mantém `MAX(seq) = COUNT(*)`, que é a premissa das duas
 *   consultas.
 *
 * O `seq` é contador interno de saldo: não sai em relatório, não é referenciado
 * por outra tabela e não é número de documento. Renumerar não reescreve
 * histórico de nada — só reaproveita a vaga.
 *
 * Roda na MESMA transação do DELETE. O `UX_meal_coupon_seq` é conferido no fim
 * do comando, e a descida em bloco (`seq - 1` sobre uma faixa contígua) não
 * passa por estado duplicado intermediário visível.
 */
function sqlResequenceCouponAfterDelete() {
    return `
        UPDATE GIPP.dbo.meal_coupon
        SET seq = seq - 1
        WHERE nfe_key = @nfe_key
          AND seq > @seq;
    `;
}

/**
 * Apaga a refeição que o resgate gravou.
 *
 * Estornar o cupom sem apagar a refeição deixaria a refeição contada no
 * relatório E o saldo devolvido — o mesmo almoço pago uma vez, contado duas e
 * servível de novo. As duas linhas nasceram na mesma transação em
 * `redeemCouponWithMealLog`, e desaparecem na mesma.
 *
 * O `NOT EXISTS` é cinto de segurança: se por algum caminho outra linha de
 * cupom ainda apontar para esta refeição, a refeição fica. A FK é NO ACTION e
 * apagaria com erro 547 de qualquer forma — assim a condição vira "não apaguei"
 * em vez de "quebrei a transação".
 */
function sqlDeleteMealLogById() {
    return `
        DELETE FROM GIPP.dbo.meal_log
        OUTPUT DELETED.id
        WHERE id = @id
          AND NOT EXISTS (
              SELECT 1 FROM GIPP.dbo.meal_coupon c WHERE c.meal_log_id = @id
          );
    `;
}

module.exports = {
    sqlFindPosSiteByCnpj,
    sqlGetCouponBalance,
    sqlRedeemCoupon,
    sqlLinkCouponToMealLog,
    sqlListCoupons,
    sqlGetCouponById,
    sqlDeleteCouponById,
    sqlResequenceCouponAfterDelete,
    sqlDeleteMealLogById,
};
