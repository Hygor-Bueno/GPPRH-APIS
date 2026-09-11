// ─── gipp.repository.js ───────────────────────────────────────────────────────
// Repositório SQL Server para o módulo GIPP (Gestão de Ponto e Pagamento).
// Contém queries para marcações de ponto, jornadas de trabalho,
// processamento de pagamentos e fechamento de jornadas.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Projeção de vw_employee_work_summary ─────────────────────────────────────

/**
 * Colunas da view, na ordem em que ela as declara.
 *
 * A lista é explícita de propósito: com `SELECT *`, toda coluna acrescentada à
 * view passa a vazar por todas as rotas automaticamente — foi o que aconteceu
 * quando `id_status_fk` e `launched_by` foram adicionados.
 */
const SUMMARY_ALL_COLUMNS = [
    'company_cod',
    'cost_center',
    'registration',
    'collaborator',
    'month_salary',
    'branch_cod',
    'branch_desc',
    'hours_day',
    'total_hours',
    'normal_hour',
    'extra_hour',
    'night_hour',
    'normal_payment',
    'extra_hour_payment',
    'night_bonus_payment',
    'total_payment',
    'cod_work_schedule_fk',
    'id_status_fk',
    'launched_by',
];

/**
 * Colunas com informação financeira.
 *
 * Só a fila do RH (`/payment/approved`) as devolve: quem lança e quem aprova
 * decide olhando as HORAS, não o valor. `month_salary` entra na lista porque é
 * o salário mensal do colaborador — dado de RH, não de operação de loja.
 */
const PAYMENT_VALUE_COLUMNS = new Set([
    'month_salary',
    'normal_payment',
    'extra_hour_payment',
    'night_bonus_payment',
    'total_payment',
]);

/**
 * Monta a lista de colunas do SELECT.
 *
 * @param {boolean} withValues - `true` apenas para a fila do RH.
 * @param {string} [alias] - Prefixo da tabela. Necessário quando a query tem
 *   JOIN, senão o SQL Server acusa ambiguidade nas colunas repetidas.
 * @returns {string}
 */
function summarySelectList(withValues, alias = '') {
    const columns = withValues
        ? SUMMARY_ALL_COLUMNS
        : SUMMARY_ALL_COLUMNS.filter(c => !PAYMENT_VALUE_COLUMNS.has(c));

    const prefix = alias ? `${alias}.` : '';
    return columns.map(c => `${prefix}${c}`).join(',\n               ');
}

// ─── Status e Tipos ───────────────────────────────────────────────────────────

/**
 * Retorna todos os status disponíveis para jornadas de trabalho.
 *
 * Valores reais de `cf_status` — os rótulos gravados no banco não descrevem
 * bem o papel de cada um no fluxo, então vale a semântica ao lado:
 *
 *   1 "Pendente"    entrada registrada, falta a saída (transitório)
 *   2 "Aprovado"    jornada fechada pelo encarregado, na fila do gerente
 *   3 "Calculando"  aprovada pelo gerente, na fila do RH
 *   4 "Finalizado"  recibo gerado pelo RH
 *   5 "Cancelado"   desconsiderada
 *
 * Ver `domain/work-schedule-status.js`, que expõe isso como constantes.
 *
 * @returns {string} Query SQL
 */
function sqlGetStatus() {
    return `SELECT * FROM GIPP.dbo.cf_status;`;
}

/**
 * Retorna o resumo de jornadas de trabalho com horas e pagamentos calculados,
 * a partir da view vw_employee_work_summary.
 *
 * Filtra por filial e/ou centro de custo — ambos opcionais e combináveis (AND).
 * O padrão `@x IS NULL OR ...` deixa cada filtro inerte quando não informado.
 *
 * Como são marcações em aberto, não há filtro de período: a view não expõe
 * coluna de data (a data só existe embutida no prefixo de cod_work_schedule_fk).
 *
 * branch_cod é zero-padded em 4 posições na view ('0208'), então normalizamos
 * os dois lados da comparação — assim tanto '208' quanto '0208' encontram a
 * filial, seguindo o mesmo padrão de sqlGetTimeRecordsByCodWork.
 *
 * O filtro `id_status_fk IN (1, 2)` é explícito de propósito. Até 08/2026 ele
 * era herdado de vw_work_records, que filtrava `IN (1, 2)` no fundo da cadeia
 * de views. Esse filtro foi ampliado para `IN (1, 2, 3)` para que jornadas
 * aprovadas pelo gerente cheguem ao cálculo de pagamento — sem repetir a
 * restrição aqui, esta rota passaria a devolver as aprovadas também.
 *
 * Não devolve valores monetários — ver `summarySelectList`.
 *
 * @param {boolean} [withValues=false]
 * @returns {string} Query SQL — requer parâmetros @branch e @cost_center
 */
function sqlGetPaymentRegistered(withValues = false) {
    return `
        SELECT ${summarySelectList(withValues)}
        FROM GIPP.dbo.vw_employee_work_summary
        WHERE id_status_fk IN (1, 2)
          AND (@branch IS NULL
               OR RIGHT('0000' + LTRIM(RTRIM(branch_cod)), 4)
                = RIGHT('0000' + LTRIM(RTRIM(@branch)), 4))
          AND (@cost_center IS NULL
               OR LTRIM(RTRIM(cost_center)) = LTRIM(RTRIM(@cost_center)))
        ORDER BY collaborator;
    `;
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
 * Mesma leitura de `sqlGetPaymentRegistered`, porém restrita a um único status.
 *
 * Usada pelas filas de aprovação:
 *   - gerente → status 2 (jornada fechada, aguardando aprovação)
 *   - RH      → status 3 (aprovada, aguardando finalização)
 *
 * ⚠️ `@status` nunca vem do cliente. O caso de uso injeta a constante de
 * `WORK_SCHEDULE_STATUS` correspondente à rota, para que a permissão de cada
 * rota realmente delimite o que aquele papel enxerga.
 *
 * Os valores monetários só acompanham a fila do RH (status 3) — a do gerente
 * mostra apenas horas, que é o que ele precisa para decidir.
 *
 * @param {boolean} [withValues=false]
 * @returns {string} Query SQL — requer @status, @branch e @cost_center
 */
function sqlGetPaymentByStatus(withValues = false) {
    return `
        SELECT ${summarySelectList(withValues)}
        FROM GIPP.dbo.vw_employee_work_summary
        WHERE id_status_fk = @status
          AND (@branch IS NULL
               OR RIGHT('0000' + LTRIM(RTRIM(branch_cod)), 4)
                = RIGHT('0000' + LTRIM(RTRIM(@branch)), 4))
          AND (@cost_center IS NULL
               OR LTRIM(RTRIM(cost_center)) = LTRIM(RTRIM(@cost_center)))
        ORDER BY collaborator;
    `;
}

/**
 * Jornadas ainda no encargo de quem as lançou — status 1 (aberta) e 2 (fechada,
 * na fila do gerente), filtradas por `launched_by`.
 *
 * `launched_by` vem de `vw_employee_work_summary` e corresponde ao `id_global`
 * de quem registrou a ENTRADA (tipo 1), que é o registro que cria a jornada.
 *
 * Diferente das outras rotas da família /payment, esta NÃO exige filial ou
 * centro de custo: o próprio `launched_by` já restringe o resultado ao que uma
 * pessoa lançou, então a consulta não fica cara sem filtro adicional.
 *
 * Nunca devolve valores monetários: o encarregado confere o que lançou pelas
 * horas, e não tem por que ver salário nem valor a pagar dos colaboradores.
 *
 * Traz `IN (1, 2, 3, 6)` — tudo que ainda não encerrou. Antes de 08/2026 parava
 * em 2, então a jornada desaparecia da lista no instante em que o gerente
 * aprovava; agora o encarregado acompanha até a tesouraria fechar. Só finalizada
 * (4) e cancelada (5) saem da vista.
 *
 * Acompanha `status_name`, `status_description` e `status_order` de `cf_status`,
 * para a tela mostrar em que etapa a jornada está sem ter que replicar a tabela
 * de status no front. O `status_order` é o `workflow_order`, que é por onde a
 * lista deve ser ordenada — pelo id, "Pagando" (6) apareceria depois de
 * "Finalizado" (4), e "Cancelado" (5) no meio do fluxo.
 *
 * @returns {string} Query SQL — requer @launched_by, @branch e @cost_center
 */
function sqlGetPaymentByLauncher() {
    return `
        SELECT ${summarySelectList(false, 'v')},
               st.name             AS status_name,
               st.description      AS status_description,
               st.workflow_order   AS status_order
        FROM GIPP.dbo.vw_employee_work_summary v
        LEFT JOIN GIPP.dbo.cf_status st
            ON st.id_status = v.id_status_fk
        WHERE v.id_status_fk IN (1, 2, 3, 6)
          AND v.launched_by = @launched_by
          AND (@branch IS NULL
               OR RIGHT('0000' + LTRIM(RTRIM(v.branch_cod)), 4)
                = RIGHT('0000' + LTRIM(RTRIM(@branch)), 4))
          AND (@cost_center IS NULL
               OR LTRIM(RTRIM(v.cost_center)) = LTRIM(RTRIM(@cost_center)))
        ORDER BY st.workflow_order, v.collaborator;
    `;
}

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
 *
 * Aceita jornada aberta (1), aguardando aprovação (2) e aprovada (3).
 *
 * O status 3 entrou em 08/2026: este endpoint alimenta o modal de detalhe, e o
 * RH trabalha justamente com jornada aprovada. Com o recorte antigo (`<= 2`) ele
 * abria a jornada e via zero batidas — sem erro, parecendo jornada sem marcação.
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
        WHERE WS.id_status_fk <= 3
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
 *
 * `@registration_snapshot` e `@branch_code_snapshot` entraram em 08/2026 e são
 * a fotografia histórica do usuário de `@id_global` no momento da marcação —
 * VARCHAR, com zeros à esquerda preservados (`'002351'`, `'0202'`). O INSERT
 * mora dentro da procedure, então preencher as colunas exigiu acrescentar os
 * dois parâmetros lá: ver `alter-prc-cf-time-records-snapshots.sql`, na pasta
 * de scripts SQL fora do repositório (ver docs/gipp-auditoria-jornada.md).
 *
 * @returns {string} Query SQL de EXEC
 */
function sqlInsertTimeRecord() {
    return `
        EXEC GIPP.dbo.prc_insert_cf_time_records
            @employee_id           = @employee_id,
            @id_global             = @id_global,
            @id_record_type_fk     = @id_record_type_fk,
            @times                 = @times,
            @branch_time_record    = @branch_time_record,
            @registration_snapshot = @registration_snapshot,
            @branch_code_snapshot  = @branch_code_snapshot;
    `;
}

/**
 * Atualiza um registro de ponto existente via stored procedure.
 * Valida o formato da data antes de executar (ISO 8601 - formato 126).
 * Lança erro 50000 se o formato da data for inválido.
 *
 * Os snapshots viajam junto porque a procedure faz
 * `id_global = ISNULL(@id_global, id_global)` — cada edição sobrescreve o
 * `id_global` com quem editou. Sem atualizar matrícula e filial no mesmo
 * comando, a linha ficaria com `id_global` de uma pessoa e snapshot de outra,
 * que é justamente a incoerência que essas colunas existem para evitar.
 *
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
            @id_time_records       = @id_time_records,
            @id_global             = @id_global,
            @times                 = @times_converted,
            @registration_snapshot = @registration_snapshot,
            @branch_code_snapshot  = @branch_code_snapshot;
    `;
}

// ─── Jornadas de Trabalho ─────────────────────────────────────────────────────

/**
 * Cancela uma jornada de trabalho alterando seu status para 5 (Cancelado).
 *
 * A guarda de status entrou em 08/2026: antes disso o UPDATE não checava o
 * estado atual e cancelava qualquer jornada, inclusive já finalizada em 4 —
 * o que apagava um pagamento fechado sem deixar rastro.
 *
 * Quais status podem ser cancelados depende de QUEM está cancelando, e por isso
 * a lista chega por parâmetro em vez de ficar fixa aqui: encarregado e gerente
 * alcançam 1 e 2; o RH alcança também a 3, que está na fila dele. Ver
 * `DISCARDABLE_STATUSES` e `PAYROLL_DISCARDABLE_STATUSES` no domínio.
 *
 * `rowsAffected` volta zerado quando a guarda barra; o caso de uso traduz
 * isso em 409 em vez de responder sucesso silencioso.
 *
 * @param {number[]} allowedStatuses
 * @returns {{ sql: string, params: object }} Requer ainda @cod_work_schedule e @st_cancelled
 */
function sqlCancelWorkSchedule(allowedStatuses) {
    const params = {};
    const placeholders = allowedStatuses.map((s, i) => {
        params[`st${i}`] = s;
        return `@st${i}`;
    });

    return {
        sql: `
            UPDATE GIPP.dbo.cf_work_schedules
            SET id_status_fk = @st_cancelled
            WHERE cod_work_schedule = @cod_work_schedule
              AND id_status_fk IN (${placeholders.join(', ')});
        `,
        params,
    };
}

/**
 * Estado atual de uma lista de jornadas. Usado antes das transições para
 * separar o que pode avançar do que precisa ser reportado como ignorado.
 *
 * @param {string[]} scheduleList
 * @returns {{ sql: string, params: object }}
 */
function sqlGetWorkSchedulesStatus(scheduleList) {
    const params = {};
    const placeholders = scheduleList.map((s, i) => {
        params[`ws${i}`] = s;
        return `@ws${i}`;
    });

    return {
        sql: `
            SELECT cod_work_schedule, id_status_fk
            FROM GIPP.dbo.cf_work_schedules
            WHERE cod_work_schedule IN (${placeholders.join(', ')});
        `,
        params,
    };
}

/**
 * Aprovação do gerente — move jornadas de 2 (aguardando aprovação) para
 * 3 (aguardando o RH).
 *
 * O `AND id_status_fk = @from_status` é a trava real da transição: mesmo que
 * um código de jornada em 1, 4 ou 5 chegue por engano na lista, a linha não é
 * tocada. A validação no caso de uso existe para dar mensagem, não para
 * garantir a regra.
 *
 * @param {string[]} scheduleList
 * @returns {{ sql: string, params: object }}
 */
function sqlApproveWorkSchedules(scheduleList) {
    const params = {};
    const placeholders = scheduleList.map((s, i) => {
        params[`ws${i}`] = s;
        return `@ws${i}`;
    });

    return {
        sql: `
            UPDATE GIPP.dbo.cf_work_schedules
            SET id_status_fk = @to_status
            WHERE cod_work_schedule IN (${placeholders.join(', ')})
              AND id_status_fk = @from_status;
        `,
        params,
    };
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
            -- Não vai para a procedure do MySQL (que recebe 12 parâmetros fixos):
            -- serve para saber a qual jornada cada pagamento pertence, e assim
            -- poder pular só a jornada cujo colaborador não existe no MySQL, em
            -- vez de abortar o lote inteiro.
            F.cod_work_schedule                                                   AS cod_work_schedule,
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
    sqlGetPaymentByStatus,
    sqlGetPaymentByLauncher,
    sqlGetRecordTypes,
    sqlGetTimeRecords,
    sqlGetTimeRecordsByCodWork,
    sqlInsertTimeRecord,
    sqlUpdateTimeRecord,
    sqlCancelWorkSchedule,
    sqlGetWorkSchedulesStatus,
    sqlApproveWorkSchedules,
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
