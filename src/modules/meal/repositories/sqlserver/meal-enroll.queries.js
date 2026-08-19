/**
 * @fileoverview Queries do autocadastro facial — convite e vetor.
 *
 * Duas tabelas: `meal_enroll_token` (estado do link) e `meal_biometric` (o
 * vetor). Nenhuma consulta aqui grava imagem, e nenhuma devolve o vetor para
 * fora do servidor — o `embedding` só sai daqui para o container `face`, na
 * rede interna do compose.
 *
 * @module modules/meal/repositories/sqlserver/meal-enroll.queries
 */

// ─── Convite ─────────────────────────────────────────────────────────────────

/**
 * Emite o convite.
 *
 * `UX_meal_enroll_token_open` é índice único filtrado sobre
 * (company_code, employee_id, branch_code) onde o token está aberto. Emitir para
 * quem já tem convite vivo estoura violação de unicidade, e isso é o
 * comportamento desejado: dois links válidos para a mesma pessoa significam dois
 * caminhos para o mesmo cadastro, e nenhum jeito de saber qual foi usado.
 *
 * Quem quiser reemitir tem que queimar o anterior primeiro — ver `sqlBurnToken`.
 */
function sqlInsertToken() {
    return `
        INSERT INTO GIPP.dbo.meal_enroll_token (
            jti, company_code, employee_id, branch_code,
            expires_at, issued_by
        )
        VALUES (
            @jti, @company_code, @employee_id, @branch_code,
            @expires_at, @issued_by
        );

        SELECT jti, company_code, employee_id, branch_code,
               issued_at, expires_at, issued_by, attempts
        FROM GIPP.dbo.meal_enroll_token
        WHERE jti = @jti;
    `;
}

/**
 * Estado do convite, com o nome e a data de nascimento vindos do Protheus.
 *
 * O `RA_NASC` entra por `OUTER APPLY` na hora da conferência e **não é
 * guardado em lugar nenhum** — nem no token, nem em log. Ele existe em memória
 * pelo tempo de uma comparação.
 *
 * `employee_name` vem junto porque o fluxo devolve o nome para a pessoa
 * conferir. Mas ele só sai da API DEPOIS de a data bater: devolver o nome antes
 * transformaria o endpoint num oráculo — manda matrícula, recebe nome.
 */
function sqlFindToken() {
    return `
        SELECT t.jti,
               t.company_code,
               t.employee_id,
               t.branch_code,
               t.issued_at,
               t.expires_at,
               t.attempts,
               t.consumed_at,
               t.burned_at,
               t.burned_reason,
               CASE WHEN t.expires_at <= SYSDATETIME() THEN 1 ELSE 0 END AS is_expired,
               d.employee_name,
               d.employee_full_name,
               d.is_terminated,
               rh.RA_NASC AS birth_date_raw
        FROM GIPP.dbo.meal_enroll_token t

        OUTER APPLY (
            SELECT TOP 1 x.employee_name, x.employee_full_name, x.is_terminated
            FROM GIPP.dbo.vw_meal_diner x
            WHERE x.company_code = t.company_code
              AND x.employee_id  = t.employee_id
              AND x.branch_code  = t.branch_code
        ) d

        /* A data de nascimento é lida da tabela da empresa certa. O sufixo vem do
           company_code, então a busca é por união filtrada — não há como ler o
           RA_NASC de outra empresa por engano. */
        OUTER APPLY (
            SELECT TOP 1 u.RA_NASC FROM (
                SELECT '01' AS cc, RA_MAT, RA_FILIAL, RA_NASC FROM TMPPRD12.dbo.SRA010 WHERE D_E_L_E_T_ <> '*'
                UNION ALL SELECT '02', RA_MAT, RA_FILIAL, RA_NASC FROM TMPPRD12.dbo.SRA020 WHERE D_E_L_E_T_ <> '*'
                UNION ALL SELECT '03', RA_MAT, RA_FILIAL, RA_NASC FROM TMPPRD12.dbo.SRA030 WHERE D_E_L_E_T_ <> '*'
                UNION ALL SELECT '06', RA_MAT, RA_FILIAL, RA_NASC FROM TMPPRD12.dbo.SRA060 WHERE D_E_L_E_T_ <> '*'
                UNION ALL SELECT '07', RA_MAT, RA_FILIAL, RA_NASC FROM TMPPRD12.dbo.SRA070 WHERE D_E_L_E_T_ <> '*'
                UNION ALL SELECT '08', RA_MAT, RA_FILIAL, RA_NASC FROM TMPPRD12.dbo.SRA080 WHERE D_E_L_E_T_ <> '*'
                UNION ALL SELECT '09', RA_MAT, RA_FILIAL, RA_NASC FROM TMPPRD12.dbo.SRA090 WHERE D_E_L_E_T_ <> '*'
            ) u
            WHERE u.cc        = t.company_code
              AND LTRIM(RTRIM(u.RA_MAT))    = t.employee_id
              AND LTRIM(RTRIM(u.RA_FILIAL)) = t.branch_code
        ) rh

        WHERE t.jti = @jti;
    `;
}

/**
 * Gasta uma tentativa e devolve quantas sobraram.
 *
 * O incremento e a leitura vão na mesma instrução, com `OUTPUT`: se fossem duas
 * requisições, duas tentativas simultâneas leriam o mesmo valor e gastariam uma
 * só. Com 3 tentativas no total, essa corrida é a diferença entre 3 e infinitas.
 */
function sqlSpendAttempt() {
    return `
        UPDATE GIPP.dbo.meal_enroll_token
           SET attempts = attempts + 1
        OUTPUT INSERTED.attempts AS attempts
         WHERE jti = @jti
           AND consumed_at IS NULL
           AND burned_at   IS NULL
           AND attempts    < 3;
    `;
}

/** Queima o convite: tentativas esgotadas, revogação do RH, ou reemissão. */
function sqlBurnToken() {
    return `
        UPDATE GIPP.dbo.meal_enroll_token
           SET burned_at     = SYSDATETIME(),
               burned_reason = @burned_reason
         WHERE jti = @jti
           AND consumed_at IS NULL
           AND burned_at   IS NULL;
    `;
}

/** Queima o convite aberto de uma pessoa, para permitir reemissão. */
function sqlBurnOpenTokenFor() {
    return `
        UPDATE GIPP.dbo.meal_enroll_token
           SET burned_at     = SYSDATETIME(),
               burned_reason = @burned_reason
         WHERE company_code = @company_code
           AND employee_id  = @employee_id
           AND branch_code  = @branch_code
           AND consumed_at IS NULL
           AND burned_at   IS NULL;
    `;
}

// ─── Vetor ───────────────────────────────────────────────────────────────────

/**
 * Grava o vetor e consome o convite, **na mesma transação**.
 *
 * As duas coisas juntas ou nenhuma. Se o vetor entrasse e o token não fosse
 * consumido, o link continuaria valendo e a pessoa poderia recadastrar em cima —
 * o que não é catastrófico. O inverso é: token consumido sem vetor gravado deixa
 * a pessoa sem cadastro E sem link, ou seja, sem caminho de volta a não ser
 * suporte manual.
 *
 * A transação é aberta pelo repositório, não aqui: esta função devolve só o SQL.
 */
function sqlUpsertBiometric() {
    return `
        MERGE GIPP.dbo.meal_biometric AS target
        USING (SELECT @company_code AS company_code,
                      @employee_id  AS employee_id,
                      @branch_code  AS branch_code) AS source
           ON target.company_code = source.company_code
          AND target.employee_id  = source.employee_id
          AND target.branch_code  = source.branch_code

        WHEN MATCHED THEN UPDATE SET
            embedding          = @embedding,
            model_tag          = @model_tag,
            enrolled_at        = SYSDATETIME(),
            enroll_verified_by = @enroll_verified_by,
            consent_at         = @consent_at,
            consent_version    = @consent_version,
            consent_ip         = @consent_ip,
            /* Recadastrar reativa: quem revogou e voltou não fica preso ao
               estado anterior. */
            revoked_at         = NULL

        WHEN NOT MATCHED THEN INSERT (
            company_code, employee_id, branch_code,
            embedding, model_tag, enroll_verified_by,
            consent_at, consent_version, consent_ip
        ) VALUES (
            @company_code, @employee_id, @branch_code,
            @embedding, @model_tag, @enroll_verified_by,
            @consent_at, @consent_version, @consent_ip
        );
    `;
}

function sqlConsumeToken() {
    return `
        UPDATE GIPP.dbo.meal_enroll_token
           SET consumed_at = SYSDATETIME()
         WHERE jti = @jti
           AND consumed_at IS NULL
           AND burned_at   IS NULL;
    `;
}

/**
 * Lê o vetor para a comparação 1:1.
 *
 * `revoked_at IS NULL` no WHERE, não no código que chama: quem revogou não pode
 * ser reconhecido por rosto, e esquecer esse filtro numa camada acima seria
 * ignorar uma revogação — o pior defeito possível neste módulo.
 */
function sqlFindBiometricForVerify() {
    return `
        SELECT company_code, employee_id, branch_code,
               embedding, model_tag, enrolled_at
        FROM GIPP.dbo.meal_biometric
        WHERE company_code = @company_code
          AND employee_id  = @employee_id
          AND branch_code  = @branch_code
          AND revoked_at IS NULL;
    `;
}

/**
 * Revoga.
 *
 * Marca, não apaga: o expurgo leva na próxima execução. Isso deixa rastro
 * auditável de que a revogação foi respeitada, em vez de a linha simplesmente
 * desaparecer e ninguém poder provar que existiu.
 */
function sqlRevokeBiometric() {
    return `
        UPDATE GIPP.dbo.meal_biometric
           SET revoked_at = SYSDATETIME()
         WHERE company_code = @company_code
           AND employee_id  = @employee_id
           AND branch_code  = @branch_code
           AND revoked_at IS NULL;
    `;
}

/** Situação do cadastro facial de uma pessoa. Nunca devolve o vetor. */
function sqlFindBiometricStatus() {
    return `
        SELECT company_code, employee_id, branch_code,
               model_tag, enrolled_at, enroll_verified_by,
               consent_at, consent_version, revoked_at,
               DATALENGTH(embedding) AS embedding_bytes
        FROM GIPP.dbo.meal_biometric
        WHERE company_code = @company_code
          AND employee_id  = @employee_id
          AND branch_code  = @branch_code;
    `;
}

module.exports = {
    sqlInsertToken,
    sqlFindToken,
    sqlSpendAttempt,
    sqlBurnToken,
    sqlBurnOpenTokenFor,
    sqlUpsertBiometric,
    sqlConsumeToken,
    sqlFindBiometricForVerify,
    sqlRevokeBiometric,
    sqlFindBiometricStatus,
};
