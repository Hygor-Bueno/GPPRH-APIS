// ─── gipp.repository.js ───────────────────────────────────────────────────────
// Repositório SQL Server para o módulo GIPP (Gestão de Ponto e Pagamento).
// Contém queries para marcações de ponto, jornadas de trabalho,
// processamento de pagamentos e fechamento de jornadas.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Status e Tipos ───────────────────────────────────────────────────────────

/**
 * Retorna todos os status disponíveis para jornadas de trabalho.
 * Ex: 1=Pendente, 2=Calculando, 3=Processado, 4=Pago, 5=Cancelado.
 * @returns {string} Query SQL
 */
function sqlGetStatus() {
    return `SELECT * FROM GIPP.dbo.cf_status;`;
}

/**
 * Retorna o resumo de jornadas de trabalho com horas e pagamentos calculados,
 * a partir da view vw_employee_work_summary.
 * A view filtra apenas jornadas com status 1 (Pendente) e 2 (Calculando).
 * @returns {string} Query SQL
 */
function sqlGetPaymentRegistered() {
    return `SELECT * FROM GIPP.dbo.vw_employee_work_summary;`;
}
// Versão anterior com campos formatados (mantida como referência):
// function sqlGetPaymentRegistered() {
//     return `
//         SELECT
//             registration,
//             collaborator,
//             GIPP.dbo.fn_format_currency_ptbr(month_salary)        AS month_salary,
//             branch_desc,
//             total_hours,
//             normal_hour,
//             extra_hour,
//             night_hour,
//             GIPP.dbo.fn_format_currency_ptbr(normal_payment)      AS normal_payment,
//             GIPP.dbo.fn_format_currency_ptbr(extra_hour_payment)  AS extra_hour_payment,
//             GIPP.dbo.fn_format_currency_ptbr(night_bonus_payment) AS night_bonus_payment,
//             GIPP.dbo.fn_format_currency_ptbr(total_payment)       AS total_payment,
//             cod_work_schedule_fk
//         FROM GIPP.dbo.vw_employee_work_summary;
//     `;
// }

/**
 * Retorna os tipos de registro de ponto ativos.
 * Ex: 1=Entrada, 2=Início Intervalo, 3=Fim Intervalo, 4=Saída.
 * @returns {string} Query SQL
 */
function sqlGetRecordTypes() {
    return `SELECT * FROM GIPP.dbo.record_type WHERE status = '1';`;
}

// ─── Registros de Ponto ───────────────────────────────────────────────────────

/**
 * Busca todos os registros de ponto de uma jornada específica,
 * enriquecidos com nome do colaborador, data, hora, centro de custo e filial.
 * Filtra apenas jornadas com status <= 2 (Pendente ou Calculando).
 *
 * @returns {string} Query SQL — requer parâmetro @codWorkSchedule
 */
function sqlGetTimeRecordsByCodWork() {
    return `
        SELECT
            REC.*,
            RTRIM(LTRIM(EMPL.EmployeeName))                       AS employee_name,
            CONVERT(VARCHAR(10), CAST(REC.times AS DATE), 103)    AS date,
            CONVERT(VARCHAR(5),  CAST(REC.times AS TIME), 108)    AS hour,
            EMPL.CostCenterDescription                            AS cost_center_description,
            EMPL.BranchName                                       AS branch_name
        FROM GIPP.dbo.cf_time_records REC
        LEFT JOIN GIPP.dbo.cf_work_schedules WS
            ON REC.cod_work_schedule = WS.cod_work_schedule
        LEFT JOIN GIPP.dbo.view_employee_with_company_info EMPL
            ON RIGHT('000000' + LTRIM(RTRIM(WS.employee_id)), 6) = EMPL.EmployeeID
            AND RIGHT('0000' + LTRIM(RTRIM(WS.branch_time_record)), 4) = EMPL.BranchCode
        WHERE WS.id_status_fk <= 2
          AND REC.cod_work_schedule = @codWorkSchedule
        ORDER BY REC.cod_work_schedule DESC, REC.id_time_records;
    `;
}

/**
 * Executa a stored procedure de listagem paginada de registros de ponto.
 * Suporta filtros por jornada, status, nome, filial e centro de custo.
 * @returns {string} Query SQL de EXEC
 */
function sqlGetTimeRecords() {
    return `
        EXEC GIPP.dbo.pcr_get_time_records
            @cod_work_schedule = @cod_work_schedule,
            @id_status_fk      = @id_status_fk,
            @page_number       = @page_number,
            @page_size         = @page_size,
            @name              = @name,
            @branch            = @branch,
            @cost_center       = @cost_center;
    `;
}

/**
 * Insere um novo registro de ponto via stored procedure.
 * A procedure valida sequência de registros e cria a jornada se necessário.
 * @returns {string} Query SQL de EXEC
 */
function sqlInsertTimeRecord() {
    return `
        EXEC GIPP.dbo.prc_insert_cf_time_records
            @employee_id        = @employee_id,
            @id_global          = @id_global,
            @id_record_type_fk  = @id_record_type_fk,
            @times              = @times,
            @branch_time_record = @branch_time_record;
    `;
}

/**
 * Atualiza um registro de ponto existente via stored procedure.
 * Valida o formato da data antes de executar (ISO 8601 - formato 126).
 * Lança erro 50000 se o formato da data for inválido.
 * @returns {string} Query SQL com validação e EXEC
 */
function sqlUpdateTimeRecord() {
    return `
        DECLARE @times_converted DATETIME2;

        SET @times_converted = TRY_CONVERT(DATETIME2, @times, 126);

        IF @times_converted IS NULL
        BEGIN
            THROW 50000, 'Invalid date format for @times', 1;
        END

        EXEC GIPP.dbo.prc_update_cf_time_records
            @id_time_records = @id_time_records,
            @id_global       = @id_global,
            @times           = @times_converted;
    `;
}

// ─── Jornadas de Trabalho ─────────────────────────────────────────────────────

/**
 * Cancela uma jornada de trabalho alterando seu status para 5 (Cancelado).
 * @returns {string} Query SQL — requer parâmetro @cod_work_schedule
 */
function sqlCancelWorkSchedule() {
    return `
        UPDATE GIPP.dbo.cf_work_schedules
        SET id_status_fk = 5
        WHERE cod_work_schedule = @cod_work_schedule;
    `;
}

/**
 * Executa o processamento de múltiplas jornadas via stored procedure.
 * Calcula horas normais, extras e noturnas, e popula cf_payments.
 * Recebe lista de códigos separada por vírgula.
 * @returns {string} Query SQL de EXEC
 */
function sqlProcessWorkSchedules() {
    return `EXEC GIPP.dbo.pcr_process_work_schedules @CodWorkSchedules = @CodWorkSchedules;`;
}

// ─── Cálculo de Pagamentos para Replicação MySQL ──────────────────────────────

/**
 * Calcula os valores de pagamento de uma lista de jornadas a partir dos
 * registros de ponto brutos. Usado para replicar dados no MySQL GIPP.
 *
 * Pipeline de CTEs:
 * - Base: une registros de ponto com dados do colaborador
 * - Calculated: calcula minutos de pausa via LEAD()
 * - Aggregated: agrega entrada/saída e total de pausas por jornada
 * - WorkLayer: aplica funções de cálculo de horas normais e noturnas
 * - BusinessLayer: determina se foi expediente completo (FullExpedient)
 * - FinalLayer: separa horas normais de horas extras
 *
 * Retorna campos formatados para a procedure MySQL sp_insert_recibo_pagamento_por_cpf.
 *
 * @param {string[]} scheduleList - Lista de cod_work_schedule
 * @returns {{ sql: string, params: object }} Query e parâmetros nomeados
 */
function sqlGetPayments(scheduleList) {
    const params = {};
    // Cria parâmetros nomeados dinâmicos: @ws0, @ws1, @ws2...
    const placeholders = scheduleList.map((s, i) => {
        params[`ws${i}`] = s;
        return `@ws${i}`;
    });

    const sql = `
        WITH Base AS (
            SELECT
                empl.EmployeeID        AS RA_MAT,
                empl.EmployeeCPF       AS RA_CIC,
                empl.EmployeeFullName  AS RA_NOMECMP,
                empl.BranchCode        AS RA_FILIAL,
                empl.EmployeeSalary    AS RA_SALARIO,
                empl.EmployeeMonthHours AS RA_HRSMES,
                empl.EmployeeDayHours  AS RA_HRSDIA,
                CAST(times AS DATETIME) AS record_times,
                id_record_type_fk,
                WS.cod_work_schedule
            FROM GIPP.dbo.cf_time_records
            LEFT JOIN GIPP.dbo.cf_work_schedules WS
                ON cf_time_records.cod_work_schedule = WS.cod_work_schedule
            INNER JOIN GIPP.dbo.view_employee_with_company_info empl
                ON RIGHT('000000' + LTRIM(RTRIM(WS.employee_id)), 6)       = empl.EmployeeID
                AND RIGHT('0000' + LTRIM(RTRIM(WS.branch_time_record)), 4) = empl.BranchCode
            WHERE WS.cod_work_schedule IN (${placeholders.join(', ')})
        ),
        Calculated AS (
            SELECT *,
                -- LEAD calcula minutos de cada pausa (tipo 2 = início intervalo)
                CASE
                    WHEN id_record_type_fk = 2 THEN
                        DATEDIFF(MINUTE, record_times,
                            LEAD(record_times) OVER (PARTITION BY RA_MAT ORDER BY record_times))
                    ELSE 0
                END AS PauseMinutes
            FROM Base
        ),
        Aggregated AS (
            SELECT
                RA_MAT, RA_CIC, RA_NOMECMP, RA_FILIAL, RA_SALARIO, RA_HRSMES, RA_HRSDIA,
                cod_work_schedule,
                SUM(PauseMinutes)                                                          AS TotalPauseMinutes,
                MIN(CASE WHEN id_record_type_fk = 1 THEN record_times END)                AS StartTime,
                MAX(CASE WHEN id_record_type_fk = 4 THEN record_times END)                AS EndTime
            FROM Calculated
            GROUP BY RA_MAT, RA_CIC, RA_NOMECMP, RA_FILIAL, RA_SALARIO, RA_HRSMES, RA_HRSDIA, cod_work_schedule
        ),
        WorkLayer AS (
            SELECT A.*,
                -- fn_calculate_work_minutes: (saída - entrada) - pausas
                GIPP.dbo.fn_calculate_work_minutes(A.StartTime, A.EndTime, ISNULL(A.TotalPauseMinutes, 0)) AS TotalWorkMinutes,
                -- fn_calculate_night_minutes: minutos trabalhados entre 22h e 5h
                GIPP.dbo.fn_calculate_night_minutes(A.StartTime, A.EndTime)                                AS NightMinutes,
                0 AS NightPauseMinutes
            FROM Aggregated A
        ),
        BusinessLayer AS (
            SELECT W.*,
                CAST(CEILING(W.RA_HRSDIA * 60) AS INT) AS DailyMinutes,
                -- FullExpedient = 1 se trabalhou >= carga horária diária
                CASE WHEN W.TotalWorkMinutes >= CAST(CEILING(W.RA_HRSDIA * 60) AS INT) THEN 1 ELSE 0 END AS FullExpedient
            FROM WorkLayer W
        ),
        FinalLayer AS (
            SELECT B.*,
                -- Horas normais: limitadas à carga diária se expediente completo
                CASE WHEN B.FullExpedient = 1 THEN B.DailyMinutes ELSE B.TotalWorkMinutes END AS WorkMinutes,
                -- Horas extras: apenas se expediente completo (excedente além da carga + noturnas)
                CASE WHEN B.FullExpedient = 1 THEN B.TotalWorkMinutes - B.DailyMinutes - B.NightMinutes ELSE 0 END AS WorkExtraMinutes
            FROM BusinessLayer B
        )
        SELECT
            F.RA_CIC                                                              AS cpf,
            CONVERT(VARCHAR(10), StartTime, 103)                                  AS data,
            'Serviços Prestados'                                                  AS descricao,
            -- referencia: '1d' se expediente completo, senão 'Xh:Ym'
            CASE WHEN FullExpedient = 1 THEN '1d'
                 ELSE CONCAT(F.WorkMinutes / 60, ':', RIGHT('00' + CAST(F.WorkMinutes % 60 AS VARCHAR(2)), 2))
            END                                                                   AS referencia,
            PAY.normal_payment                                                    AS proventos,
            'Hora(s) Extra(s)'                                                    AS descricao2,
            -- referencia2: duração das horas extras formatada
            CASE WHEN F.WorkExtraMinutes <= 0 THEN '0 min'
                 WHEN F.WorkExtraMinutes < 60  THEN CONCAT(F.WorkExtraMinutes, ' min')
                 WHEN F.WorkExtraMinutes % 60 = 0 THEN CONCAT(F.WorkExtraMinutes / 60, ' h')
                 ELSE CONCAT(F.WorkExtraMinutes / 60, 'h', F.WorkExtraMinutes % 60, 'm')
            END                                                                   AS referencia2,
            PAY.extra_hour_payment                                                AS proventos2,
            'Hora(s) Extra(s) Noturna(s)'                                        AS descricao3,
            -- referencia3: duração das horas noturnas formatada
            CASE WHEN F.NightMinutes <= 0 THEN '0 min'
                 WHEN F.NightMinutes < 60  THEN CONCAT(F.NightMinutes, ' min')
                 WHEN F.NightMinutes % 60 = 0 THEN CONCAT(F.NightMinutes / 60, ' h')
                 ELSE CONCAT(F.NightMinutes / 60, 'h', F.NightMinutes % 60, 'm')
            END                                                                   AS referencia3,
            PAY.night_bonus_payment                                               AS proventos3,
            ISNULL(PAY.normal_payment, 0)
            + ISNULL(PAY.extra_hour_payment, 0)
            + ISNULL(PAY.night_bonus_payment, 0)                                 AS total_proventos
        FROM FinalLayer F
        LEFT JOIN GIPP.dbo.cf_payments PAY
            ON PAY.cod_work_schedule_fk = F.cod_work_schedule
        ORDER BY F.RA_MAT, F.RA_CIC;
    `;

    return { sql, params };
}

// ─── Fechamento de Pagamento ──────────────────────────────────────────────────

/**
 * Retorna dados da jornada, do colaborador e da empresa necessários para o fechamento.
 * Usado no passo 2 do closeWorkSchedules para montar o payload do recibo.
 *
 * @returns {string} Query SQL — requer parâmetro @cod_work_schedule
 */
function sqlGetWorkScheduleData() {
    return `
        SELECT
            WS.cod_work_schedule,
            WS.employee_id,
            WS.branch_time_record,
            WS.id_status_fk,
            LTRIM(RTRIM(EMP.EmployeeName)) AS employee_name,
            LTRIM(RTRIM(COMP.M0_CODIGO))   AS company_code,
            LTRIM(RTRIM(EMP.BranchName))   AS branch_name
        FROM GIPP.dbo.cf_work_schedules WS
        INNER JOIN GIPP.dbo.view_employee_with_company_info EMP
            ON RIGHT('000000' + LTRIM(RTRIM(WS.employee_id)), 6)       = EMP.EmployeeID
            AND RIGHT('0000' + LTRIM(RTRIM(WS.branch_time_record)), 4) = EMP.BranchCode
        INNER JOIN TMPPRD12.dbo.SYS_COMPANY COMP
            ON COMP.M0_CODFIL   = EMP.BranchCode
            AND COMP.D_E_L_E_T_ <> '*'
        WHERE WS.cod_work_schedule = @cod_work_schedule;
    `;
}

/**
 * Retorna os valores monetários calculados de uma jornada processada.
 * Inclui total_hours para enriquecer a descrição do recibo no fechamento.
 * Populado pela stored procedure pcr_process_work_schedules.
 *
 * @returns {string} Query SQL — requer parâmetro @cod_work_schedule
 */
function sqlGetPaymentDataByCodWork() {
    return `
        SELECT
            total_hours,
            normal_payment,
            extra_hour_payment,
            night_bonus_payment
        FROM GIPP.dbo.cf_payments
        WHERE cod_work_schedule_fk = @cod_work_schedule;
    `;
}

/**
 * Retorna a referência YYYYMM e a data de trabalho formatada (DD/MM/YYYY)
 * a partir do primeiro registro de entrada (tipo 1) da jornada.
 * Usada para preencher o campo reference e o prefixo da descrição do recibo.
 *
 * @returns {string} Query SQL — requer parâmetro @cod_work_schedule
 */
function sqlGetWorkScheduleReference() {
    return `
        SELECT TOP 1
            FORMAT(CAST(times AS DATETIME), 'yyyyMM')          AS reference,
            CONVERT(VARCHAR(10), CAST(times AS DATE), 103)     AS work_date
        FROM GIPP.dbo.cf_time_records
        WHERE cod_work_schedule  = @cod_work_schedule
          AND id_record_type_fk  = 1
        ORDER BY times ASC;
    `;
}

/**
 * Verifica se já existem recibos ativos para esta jornada (prevenção de duplicatas).
 *
 * O event_code usa o formato 'TIPO|cod_work_schedule' (ex: 'N|202605010002081234')
 * pois cod_work_schedule é sequencial (não UUID) e não pode ser UNIQUEIDENTIFIER.
 * Filtra apenas payment_type_id = 6 (fechamento de jornada GIPP) e is_active = 1.
 *
 * @returns {string} Query SQL — requer parâmetro @cod_work_schedule
 */
function sqlCheckExistingReceipt() {
    return `
        SELECT COUNT(*) AS total
        FROM GIPP.dbo.gipp_payment_receipt
        WHERE event_code      LIKE '%|' + @cod_work_schedule
          AND payment_type_id  = 6
          AND is_active        = 1;
    `;
}

/**
 * Calcula as durações individuais de uma jornada diretamente dos registros de ponto.
 * Usado no fechamento para enriquecer o campo description de cada item do recibo
 * com a duração específica (ex: "Hora(s) Extra(s) - 5h40m").
 *
 * Pipeline de CTEs:
 * - Base: une registros de ponto com carga horária do colaborador
 * - Calculated: calcula minutos de pausa via LEAD()
 * - Agg: agrega entrada/saída e total de pausas
 * - Work: aplica funções fn_calculate_work_minutes e fn_calculate_night_minutes
 *
 * Retorna:
 * - FullExpedient (0|1): se trabalhou >= carga horária diária
 * - WorkMinutes: minutos de horas normais
 * - WorkExtraMinutes: minutos de horas extras
 * - NightMinutes: minutos de horas noturnas
 *
 * @returns {string} Query SQL — requer parâmetro @cod_work_schedule
 */
function sqlGetWorkDurations() {
    return `
        WITH Base AS (
            SELECT
                CAST(tr.times AS DATETIME) AS record_times,
                tr.id_record_type_fk,
                empl.EmployeeDayHours AS RA_HRSDIA
            FROM GIPP.dbo.cf_time_records tr
            LEFT JOIN GIPP.dbo.cf_work_schedules WS
                ON tr.cod_work_schedule = WS.cod_work_schedule
            INNER JOIN GIPP.dbo.view_employee_with_company_info empl
                ON RIGHT('000000' + LTRIM(RTRIM(WS.employee_id)), 6)       = empl.EmployeeID
                AND RIGHT('0000' + LTRIM(RTRIM(WS.branch_time_record)), 4) = empl.BranchCode
            WHERE tr.cod_work_schedule = @cod_work_schedule
        ),
        Calculated AS (
            SELECT *,
                -- Calcula duração de cada pausa (tipo 2 = início intervalo)
                CASE
                    WHEN id_record_type_fk = 2 THEN
                        DATEDIFF(MINUTE, record_times,
                            LEAD(record_times) OVER (ORDER BY record_times))
                    ELSE 0
                END AS PauseMinutes
            FROM Base
        ),
        Agg AS (
            SELECT
                SUM(PauseMinutes)                                                       AS TotalPauseMinutes,
                MIN(CASE WHEN id_record_type_fk = 1 THEN record_times END)             AS StartTime,
                MAX(CASE WHEN id_record_type_fk = 4 THEN record_times END)             AS EndTime,
                MAX(RA_HRSDIA)                                                          AS RA_HRSDIA
            FROM Calculated
        ),
        Work AS (
            SELECT *,
                GIPP.dbo.fn_calculate_work_minutes(StartTime, EndTime, ISNULL(TotalPauseMinutes, 0)) AS TotalWorkMinutes,
                GIPP.dbo.fn_calculate_night_minutes(StartTime, EndTime)                               AS NightMinutes,
                CAST(CEILING(RA_HRSDIA * 60) AS INT)                                                  AS DailyMinutes
            FROM Agg
        )
        SELECT
            CASE WHEN TotalWorkMinutes >= DailyMinutes THEN 1 ELSE 0 END                              AS FullExpedient,
            CASE WHEN TotalWorkMinutes >= DailyMinutes THEN DailyMinutes     ELSE TotalWorkMinutes END AS WorkMinutes,
            CASE WHEN TotalWorkMinutes >= DailyMinutes
                 THEN TotalWorkMinutes - DailyMinutes - NightMinutes
                 ELSE 0 END                                                                            AS WorkExtraMinutes,
            NightMinutes
        FROM Work;
    `;
}

/**
 * Retorna os registros de ponto de uma jornada para validação antes do fechamento.
 * Verifica existência de entrada, saída e pares de intervalo íntegros.
 *
 * @returns {string} Query SQL — requer parâmetro @cod_work_schedule
 */
function sqlGetTimeRecordsForValidation() {
    return `
        SELECT
            id_time_records,
            id_record_type_fk,
            CAST(times AS DATETIME) AS times
        FROM GIPP.dbo.cf_time_records
        WHERE cod_work_schedule = @cod_work_schedule
        ORDER BY times ASC;
    `;
}

module.exports = {
    sqlGetStatus,
    sqlGetPaymentRegistered,
    sqlGetRecordTypes,
    sqlGetTimeRecords,
    sqlGetTimeRecordsByCodWork,
    sqlInsertTimeRecord,
    sqlUpdateTimeRecord,
    sqlCancelWorkSchedule,
    sqlProcessWorkSchedules,
    sqlGetPayments,
    // Fechamento de jornada
    sqlGetWorkScheduleData,
    sqlGetPaymentDataByCodWork,
    sqlGetWorkScheduleReference,
    sqlGetWorkDurations,
    sqlCheckExistingReceipt,
    sqlGetTimeRecordsForValidation
};
