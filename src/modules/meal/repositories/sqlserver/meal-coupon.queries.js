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

module.exports = {
    sqlFindPosSiteByCnpj,
    sqlGetCouponBalance,
    sqlRedeemCoupon,
    sqlLinkCouponToMealLog,
};