/* =============================================================================
   Snapshots históricos em cf_time_records — parâmetros nas procedures
   =============================================================================

   ⚠️ REVISAR E APLICAR MANUALMENTE. Nada aqui é executado pelo backend.

   ⚠️⚠️ ORDEM DE DEPLOY — APLIQUE ESTE SCRIPT **ANTES** DE SUBIR O BACKEND.

   O backend já envia @registration_snapshot e @branch_code_snapshot no EXEC.
   Contra a procedure atual, o SQL Server recusa a chamada inteira:

       "Procedure or function prc_insert_cf_time_records has too many
        arguments specified."

   Verificado contra o banco em 21/08/2026. Ou seja: subir o backend antes deste
   script derruba POST /gipp/time-records por completo — nenhuma marcação é
   registrada. Aplicar o script antes é seguro na ordem inversa: os parâmetros
   têm default NULL, então a procedure nova funciona com o backend antigo.

   POR QUE ALTERAR A PROCEDURE
   ---------------------------
   As colunas `registration_snapshot VARCHAR(6)` e `branch_code_snapshot
   VARCHAR(4)` já existem em `dbo.cf_time_records`, mas o INSERT que popula a
   tabela mora DENTRO de `prc_insert_cf_time_records` e lista as colunas
   explicitamente (times, id_record_type_fk, created_at, updated_at, id_global,
   cod_work_schedule). O backend não tem como preencher coluna que a procedure
   não escreve — daí os dois parâmetros novos.

   Conferido em 21/08/2026: 66.515 linhas em cf_time_records, 58 sem snapshot,
   TODAS de 2026-08 — ou seja, os inserts feitos depois do backfill. Nenhum
   trigger preenche esses campos: `trg_before_insert_cf_time_records` está com o
   corpo inteiro comentado e `trg_update_cf_time_records` só toca `updated_at`.

   DE QUEM É O SNAPSHOT
   --------------------
   Do usuário de `id_global`, que neste banco é QUEM LANÇOU a marcação — não o
   colaborador da jornada. Evidência: 29 valores distintos de `id_global` contra
   1.247 `employee_id`; as 66.457 linhas já preenchidas têm 28 matrículas
   distintas; e `vw_employee_work_summary` projeta a coluna como
   `launched_by -- id_global de quem lancou a entrada`. O colaborador está em
   `cf_work_schedules.employee_id` + `branch_time_record`.

   VARCHAR, NÃO INT
   ----------------
   `'002351'` e `'0202'` precisam manter os zeros à esquerda. Os parâmetros são
   VARCHAR e o backend envia string (`sql.VarChar(6)` / `sql.VarChar(4)`).
   Compare com `@employee_id INT` e `@branch_time_record INT`, que já perdem o
   zero e obrigam as consultas a repadronizar com RIGHT('000000'+...,6).

   COMPATIBILIDADE
   ---------------
   Os dois parâmetros têm `= NULL` como default, então qualquer chamador atual
   (outro sistema, job, execução manual) continua funcionando sem alteração — só
   grava NULL nas colunas novas, exatamente como hoje.
   ============================================================================= */

USE GIPP;
GO

/* -----------------------------------------------------------------------------
   1/2 — prc_insert_cf_time_records

   Mudanças em relação à versão atual, e SOMENTE estas:
     - dois parâmetros novos ao final da lista, ambos com default NULL;
     - as duas colunas no INSERT final.

   O resto do corpo (validação de data futura, duplicidade de entrada/saída,
   consistência de jornada noturna, chamada de pcr_post_cf_work_schedule na
   entrada e de pcr_put_status_cf_work_schedule na saída, transação e CATCH) está
   preservado sem alteração.
   ----------------------------------------------------------------------------- */
ALTER PROCEDURE [dbo].[prc_insert_cf_time_records]
    @employee_id INT,
    @id_record_type_fk INT,
    @id_global INT,
    @times VARCHAR(23) = NULL,
    @id_status_fk INT = NULL,
    @branch_time_record INT,
    -- NOVOS: fotografia do usuário de @id_global no momento da marcação.
    @registration_snapshot VARCHAR(6) = NULL,
    @branch_code_snapshot  VARCHAR(4) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    BEGIN TRANSACTION;

    BEGIN TRY
        DECLARE @valid_times DATETIME;
        DECLARE @date_only DATE;
        DECLARE @existing_record INT;
        DECLARE @message VARCHAR(200);
        DECLARE @work_schedule_id VARCHAR(100) = NULL;

        SET @valid_times = CASE
            WHEN @times IS NOT NULL THEN TRY_CONVERT(DATETIME, @times, 120)
            ELSE GETDATE()
        END;

        IF @valid_times IS NULL
        BEGIN
            SET @valid_times = GETDATE();
        END

        -- Validação de data futura
        IF @valid_times > GETDATE()
        BEGIN
            RAISERROR('It is not allowed to register a time record with a future date.', 16, 1);
        END

        SET @date_only = CONVERT(DATE, @valid_times);
        SET @id_status_fk = ISNULL(@id_status_fk, 1);

        -- Verifica se já existe uma marcação do mesmo tipo no mesmo dia (ignorando cancelados)
        IF @id_record_type_fk IN (1, 4) -- Apenas para entradas (1) e saídas (4)
        BEGIN
            SELECT @existing_record = COUNT(*)
            FROM cf_time_records saida
            LEFT JOIN GIPP.dbo.cf_work_schedules WS
                ON saida.cod_work_schedule = WS.cod_work_schedule
            WHERE WS.employee_id = @employee_id
              AND saida.id_record_type_fk = @id_record_type_fk
              AND CONVERT(DATE, saida.times) = @date_only
              AND WS.branch_time_record = @branch_time_record
              AND WS.id_status_fk <> 5; -- Ignora registros cancelados

            IF @existing_record > 0
            BEGIN
                SET @message = CASE
                    WHEN @id_record_type_fk = 1 THEN 'There is already a registered (not cancelled) entry for this contributor on this date.'
                    WHEN @id_record_type_fk = 4 THEN 'There is already a registered departure (not cancelled) for this employee on this date.'
                END;

                RAISERROR(@message, 16, 1);
            END
        END

        -- Verifica consistência para saídas (deve existir uma entrada anterior não cancelada, considerando jornadas noturnas)
        IF @id_record_type_fk = 4 -- Saída
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM cf_time_records rec
                LEFT JOIN GIPP.dbo.cf_work_schedules WS
                    ON rec.cod_work_schedule = WS.cod_work_schedule
                WHERE WS.employee_id = @employee_id
                  AND rec.id_record_type_fk = 1 -- Entrada
                  AND (
                      -- Caso 1: Entrada no mesmo dia
                      (CONVERT(DATE, rec.times) = @date_only)
                      OR
                      -- Caso 2: Entrada no dia anterior (jornada noturna)
                      (
                          CONVERT(DATE, times) = DATEADD(DAY, -1, @date_only)
                          AND NOT EXISTS (
                              -- Verifica se não há saída registrada entre a entrada e a nova saída
                              SELECT 1
                              FROM cf_time_records saida
                              LEFT JOIN GIPP.dbo.cf_work_schedules WS
                                ON saida.cod_work_schedule = WS.cod_work_schedule
                              WHERE WS.employee_id = @employee_id
                                AND WS.branch_time_record = @branch_time_record
                                AND saida.id_record_type_fk = 4
                                AND WS.id_status_fk <> 5
                                AND saida.times > rec.times
                                AND saida.times < @valid_times
                          )
                      )
                  )
                  AND WS.branch_time_record = @branch_time_record
                  AND WS.id_status_fk <> 5 -- Ignora entradas canceladas
            )
            BEGIN
                RAISERROR('There is no valid (uncancelled) entry for this employee. It is not possible to record an exit.', 16, 1);
            END
        END

        -- Chama a procedure de cf_work_schedules apenas se for entrada (1)
        IF @id_record_type_fk = 1
        BEGIN
            EXEC pcr_post_cf_work_schedule
                @employee_id = @employee_id,
                @times = @valid_times,
                @id_status_fk = @id_status_fk,
                @branch_time_record = @branch_time_record;
        END

        -- Recupera o ID da jornada que está sendo finalizada
        SELECT @work_schedule_id = cod_work_schedule
        FROM cf_work_schedules
        WHERE employee_id = @employee_id
          AND id_status_fk = 1; -- Ou outro status apropriado

        -- Se for saída (4), atualiza a jornada correspondente
        IF @id_record_type_fk = 4
        BEGIN
            EXEC pcr_put_status_cf_work_schedule
                @employee_id = @employee_id;
        END

        -- Insere os dados na tabela cf_time_records incluindo o work_schedule_id
        INSERT INTO cf_time_records (
            times,
            id_record_type_fk,
            created_at,
            updated_at,
            id_global,
            cod_work_schedule,
            registration_snapshot,  -- NOVO
            branch_code_snapshot    -- NOVO
        )
        VALUES (
            @valid_times,
            @id_record_type_fk,
            GETDATE(),
            GETDATE(),
            @id_global,
            @work_schedule_id,
            @registration_snapshot, -- NOVO
            @branch_code_snapshot   -- NOVO
        );

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;

        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
        DECLARE @ErrorState INT = ERROR_STATE();

        RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
    END CATCH
END;
GO


/* -----------------------------------------------------------------------------
   2/2 — prc_update_cf_time_records

   Por que a de UPDATE também muda: ela faz
   `id_global = ISNULL(@id_global, id_global)`, ou seja, cada edição sobrescreve
   o id_global com quem editou. Sem atualizar os snapshots no mesmo comando, a
   linha ficaria com id_global de uma pessoa e matrícula/filial de outra — a
   incoerência exata que essas colunas existem para impedir.

   Mesmo padrão `ISNULL(@param, coluna)` do resto da procedure: quem não manda o
   parâmetro não apaga o valor existente.
   ----------------------------------------------------------------------------- */
ALTER PROCEDURE [dbo].[prc_update_cf_time_records]
    @id_time_records INT,
    @id_global INT,
    @times VARCHAR(23) = NULL,
  --  @id_status_fk INT = NULL,
    @id_record_type_fk INT = NULL,
    -- NOVOS
    @registration_snapshot VARCHAR(6) = NULL,
    @branch_code_snapshot  VARCHAR(4) = NULL
AS
BEGIN
    DECLARE @valid_times DATETIME;

    -- Se @times for passado, tenta converter, caso contrário, não atualiza
    IF @times IS NOT NULL
    BEGIN
        SET @valid_times = TRY_CONVERT(DATETIME, @times, 120);
    END

    -- Atualiza apenas os campos que foram passados
    UPDATE cf_time_records
    SET
        times = CASE WHEN @times IS NOT NULL THEN @valid_times ELSE times END,
       -- id_status_fk = ISNULL(@id_status_fk, id_status_fk),
        id_record_type_fk = ISNULL(@id_record_type_fk, id_record_type_fk),
        id_global = ISNULL(@id_global, id_global),
        registration_snapshot = ISNULL(@registration_snapshot, registration_snapshot), -- NOVO
        branch_code_snapshot  = ISNULL(@branch_code_snapshot,  branch_code_snapshot),  -- NOVO
        updated_at = GETDATE()
    WHERE id_time_records = @id_time_records;
END
GO


/* -----------------------------------------------------------------------------
   Conferência depois de aplicar
   ----------------------------------------------------------------------------- */
-- Os dois parâmetros existem?
-- SELECT o.name AS proc_name, p.name AS param, TYPE_NAME(p.user_type_id) AS type
-- FROM sys.parameters p JOIN sys.objects o ON o.object_id = p.object_id
-- WHERE o.name IN ('prc_insert_cf_time_records','prc_update_cf_time_records')
-- ORDER BY o.name, p.parameter_id;

-- Uma marcação nova nasce com os snapshots preenchidos?
-- SELECT TOP (20) id_time_records, cod_work_schedule, id_global,
--        registration_snapshot, branch_code_snapshot, created_at
-- FROM GIPP.dbo.cf_time_records
-- ORDER BY id_time_records DESC;

-- Quantas linhas seguem sem snapshot, e de quando são?
-- SELECT CONVERT(VARCHAR(7), created_at, 120) AS mes, COUNT(*) AS qtd
-- FROM GIPP.dbo.cf_time_records
-- WHERE registration_snapshot IS NULL OR branch_code_snapshot IS NULL
-- GROUP BY CONVERT(VARCHAR(7), created_at, 120) ORDER BY 1 DESC;
