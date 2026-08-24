/* =============================================================================
   OPCIONAL — snapshots do responsável em cf_work_schedule_status_history
   =============================================================================

   ⚠️ DECISÃO PENDENTE. Não aplique sem decidir a pergunta abaixo. Nada aqui é
   executado pelo backend, e o backend NÃO depende disto: ele já grava as seis
   chaves no SESSION_CONTEXT, e as três que o trigger atual não lê são
   simplesmente ignoradas pelo SQL Server, sem erro. No dia em que este script
   for aplicado, as colunas passam a ser preenchidas sem nenhuma alteração de
   código.

   O QUE ESTÁ FALTANDO
   -------------------
   Conferido em 21/08/2026: `dbo.cf_work_schedule_status_history` tem 9 colunas e
   NENHUMA das três de snapshot do responsável. Coerentemente, o trigger
   implantado lê apenas `global_user_id`, `change_source` e `change_reason` — não
   lê `user_name`, `user_registration` nem `user_branch`.

   Por isso o resultado esperado com `changed_by_name_snapshot` preenchido é
   inalcançável por qualquer mudança de backend: exige ALTER TABLE + ALTER
   TRIGGER.

   A ALTERNATIVA (sem tocar no banco)
   ----------------------------------
   Resolver o nome na LEITURA: `changed_by_global_user_id` já é gravado, e
   `access.use-cases.getUserById(id)` devolve nome, matrícula e filial do banco
   global. Uma rota de histórico pode enriquecer cada linha na hora de exibir.

   Custo dessa alternativa: NÃO é snapshot. Se a pessoa mudar de filial ou de
   matrícula, a trilha de auditoria passa a mostrar os dados novos para eventos
   antigos — retroativamente. Para trilha financeira, é exatamente o que o
   snapshot existe para impedir. Além disso o histórico está no SQL Server e o
   `_user` no MySQL: não há JOIN possível, o enriquecimento é obrigatoriamente na
   aplicação, N+1 ou em lote.

   Resumo: enriquecer na leitura resolve "quem foi"; só o snapshot resolve "quem
   era naquele momento".
   ============================================================================= */

USE GIPP;
GO

/* -----------------------------------------------------------------------------
   1/2 — Colunas novas, todas NULL para não invalidar as 16.994 linhas atuais
   (16.981 do INITIAL_LOAD + 13 já geradas pela API antes do contexto existir).
   ----------------------------------------------------------------------------- */
ALTER TABLE dbo.cf_work_schedule_status_history
    ADD changed_by_name_snapshot         NVARCHAR(150) NULL,
        changed_by_registration_snapshot VARCHAR(6)    NULL,
        changed_by_branch_snapshot       VARCHAR(4)    NULL;
GO


/* -----------------------------------------------------------------------------
   2/2 — Trigger passa a ler as outras três chaves do SESSION_CONTEXT.

   Mudanças em relação à versão atual, e somente estas:
     - três DECLARE novos, lendo user_name / user_registration / user_branch;
     - as três colunas no INSERT e os três valores no SELECT.

   O resto está preservado: `INITIAL_STATE` quando não há linha em `deleted`,
   `STATUS_CHANGED` caso contrário, o `WHERE` que ignora update sem mudança de
   status, e o COALESCE do motivo no evento inicial.

   VARCHAR nos códigos, de propósito: TRY_CONVERT(INT, ...) transformaria
   '002351' em 2351 e '0202' em 202, perdendo os zeros à esquerda.
   ----------------------------------------------------------------------------- */
ALTER TRIGGER dbo.trg_cf_work_schedules_status_history
ON dbo.cf_work_schedules
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ChangedAtUtc DATETIME2(3) = SYSUTCDATETIME();

    DECLARE @GlobalUserId INT =
        TRY_CONVERT(INT, SESSION_CONTEXT(N'global_user_id'));

    -- NOVOS
    DECLARE @UserName NVARCHAR(150) =
        TRY_CONVERT(NVARCHAR(150), SESSION_CONTEXT(N'user_name'));

    DECLARE @UserRegistration VARCHAR(6) =
        TRY_CONVERT(VARCHAR(6), SESSION_CONTEXT(N'user_registration'));

    DECLARE @UserBranch VARCHAR(4) =
        TRY_CONVERT(VARCHAR(4), SESSION_CONTEXT(N'user_branch'));

    DECLARE @ChangeSource VARCHAR(50) =
        COALESCE(
            TRY_CONVERT(VARCHAR(50), SESSION_CONTEXT(N'change_source')),
            'DIRECT_DATABASE'
        );

    DECLARE @ChangeReason VARCHAR(500) =
        TRY_CONVERT(VARCHAR(500), SESSION_CONTEXT(N'change_reason'));

    INSERT INTO dbo.cf_work_schedule_status_history
    (
        cod_work_schedule,
        previous_status_id,
        new_status_id,
        event_type,
        changed_at_utc,
        changed_by_global_user_id,
        changed_by_name_snapshot,          -- NOVO
        changed_by_registration_snapshot,  -- NOVO
        changed_by_branch_snapshot,        -- NOVO
        change_source,
        change_reason
    )
    SELECT
        i.cod_work_schedule,
        d.id_status_fk,
        i.id_status_fk,

        CASE
            WHEN d.cod_work_schedule IS NULL
                THEN 'INITIAL_STATE'
            ELSE 'STATUS_CHANGED'
        END,

        @ChangedAtUtc,
        @GlobalUserId,
        @UserName,          -- NOVO
        @UserRegistration,  -- NOVO
        @UserBranch,        -- NOVO
        @ChangeSource,

        CASE
            WHEN d.cod_work_schedule IS NULL
                THEN COALESCE(@ChangeReason, 'Marcação criada.')
            ELSE @ChangeReason
        END
    FROM inserted AS i
    LEFT JOIN deleted AS d
        ON d.cod_work_schedule = i.cod_work_schedule
    WHERE
        d.cod_work_schedule IS NULL
        OR d.id_status_fk <> i.id_status_fk;
END;
GO


/* -----------------------------------------------------------------------------
   Conferência depois de aplicar — o esperado numa aprovação de gerente:

     previous_status_id               = 2
     new_status_id                    = 3
     event_type                       = STATUS_CHANGED
     changed_by_global_user_id        = <id do gerente>
     changed_by_name_snapshot         = <nome do gerente>
     changed_by_registration_snapshot = 002351   (zeros preservados)
     changed_by_branch_snapshot       = 0202     (zeros preservados)
     change_source                    = BACKEND
     change_reason                    = Compra de folga aprovada pelo gerente
   ----------------------------------------------------------------------------- */
-- SELECT TOP (20) * FROM GIPP.dbo.cf_work_schedule_status_history
-- ORDER BY id_status_history DESC;

-- Ainda existe evento anônimo vindo da API depois do deploy?
-- SELECT change_source, COUNT(*) AS qtd,
--        SUM(CASE WHEN changed_by_global_user_id IS NULL THEN 1 ELSE 0 END) AS sem_usuario
-- FROM GIPP.dbo.cf_work_schedule_status_history
-- WHERE changed_at_utc >= '2026-08-21'
-- GROUP BY change_source;
