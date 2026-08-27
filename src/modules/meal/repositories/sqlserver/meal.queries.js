/**
 * @fileoverview Queries SQL puras — controle de refeitório (SQL Server `GIPP`).
 *
 * Nenhuma query aqui copia colaborador: a fonte de verdade é o Protheus, lido
 * através de `GIPP.dbo.vw_meal_diner`, que resolve as 7 empresas
 * (SRA010/020/030/060/070/080/090) numa linha por pessoa.
 *
 * Filtros opcionais usam `(@x IS NULL OR coluna = @x)` em vez de montar string:
 * o parâmetro é sempre enviado, tipado, e a query tem um plano só.
 *
 * @module modules/meal/repositories/sqlserver/meal.queries
 */

// ─── Comensais ────────────────────────────────────────────────────────────────

/**
 * Lista para o cache offline do aparelho.
 *
 * NÃO filtra por filial por padrão. Alguém lotado em 0203 almoçando no 0202 é
 * caso real — há duas filiais chamadas Interlagos — e filtrar por filial
 * deixaria essa pessoa sem atendimento justamente quando a rede caiu.
 *
 * Desligado ENTRA na lista, dentro da janela: o QR precisa resolver e acender o
 * alerta, não devolver "não encontrado". Fora da janela ele sai, porque 5.181
 * dos 6.900 registros são desligados e quem saiu em 2019 não está na fila.
 */
function sqlGetDinersForCache() {
    return `
        SELECT company_code,
               employee_id,
               branch_code,
               employee_name,
               employee_full_name,
               cost_center,
               cost_center_description,
               branch_name,
               is_terminated,
               terminated_at
        FROM GIPP.dbo.vw_meal_diner
        WHERE (@branch_code IS NULL OR branch_code = @branch_code)
          AND (
                is_terminated = 0
             OR terminated_at >= DATEADD(DAY, -@terminated_window_days, CAST(GETDATE() AS DATE))
              )
        ORDER BY employee_name;
    `;
}

/**
 * Resolve uma matrícula e devolve, na mesma ida ao banco, quantas refeições
 * essa pessoa já fez hoje.
 *
 * A contagem vem junto de propósito: a tela do operador mostra nome + quantas
 * hoje, e duas requisições numa fila de 300 pessoas é latência que dá para
 * evitar. `meals_today` é informativo — duplicata sinaliza, não bloqueia.
 */
function sqlFindDiner() {
    return `
        SELECT d.company_code,
               d.employee_id,
               d.branch_code,
               d.employee_name,
               d.employee_full_name,
               d.cost_center,
               d.cost_center_description,
               d.branch_name,
               d.company_name,
               d.is_terminated,
               d.terminated_at,
               d.admitted_at,
               (SELECT COUNT_BIG(*)
                  FROM GIPP.dbo.meal_log ml
                 WHERE ml.company_code = d.company_code
                   AND ml.employee_id  = d.employee_id
                   AND ml.branch_code  = d.branch_code
                   AND ml.service_date = @service_date) AS meals_today
        FROM GIPP.dbo.vw_meal_diner d
        WHERE d.company_code = @company_code
          AND d.employee_id  = @employee_id
          AND d.branch_code  = @branch_code;
    `;
}

// ─── Baldes (grupos sem matrícula) ────────────────────────────────────────────

/**
 * Os botões da tela do operador.
 *
 * `site_code IS NULL` no cadastro significa "vale em todas as lojas" — por isso
 * o filtro aceita as duas condições.
 */
function sqlGetDinerGroups() {
    return `
        SELECT id,
               label,
               payee_id,
               billable,
               requires_host,
               site_code,
               sort_order,
               is_active
        FROM GIPP.dbo.meal_diner_group
        WHERE (@only_active = 0 OR is_active = 1)
          AND (@site_code IS NULL OR site_code IS NULL OR site_code = @site_code)
        ORDER BY sort_order, label;
    `;
}

/** Um balde por id — usado antes de servir, para conferir `requires_host`. */
function sqlFindDinerGroupById() {
    return `
        SELECT id, label, payee_id, billable, requires_host, site_code, sort_order, is_active
        FROM GIPP.dbo.meal_diner_group
        WHERE id = @id;
    `;
}

function sqlInsertDinerGroup() {
    return `
        INSERT INTO GIPP.dbo.meal_diner_group (
            label, payee_id, billable, requires_host, site_code,
            sort_order, is_active, created_by, created_by_branch_code
        )
        VALUES (
            @label, @payee_id, @billable, @requires_host, @site_code,
            @sort_order, @is_active, @created_by, @created_by_branch_code
        );

        SELECT id, label, payee_id, billable, requires_host, site_code,
               sort_order, is_active, created_at, created_by, created_by_branch_code
        FROM GIPP.dbo.meal_diner_group
        WHERE id = SCOPE_IDENTITY();
    `;
}

/**
 * Campos aceitos em PATCH de balde, com o tipo mssql de cada um.
 * Mesmo padrão de `PATCH_PAYEE_FIELDS` em payee.queries.js.
 *
 * `payee_id` está aqui porque a contratante pode mudar de contrato; `label`
 * também, porque o texto do botão é ajuste de tela.
 */
const PATCH_DINER_GROUP_FIELDS = Object.freeze({
    label:         'VarChar',
    payee_id:      'Int',
    billable:      'Bit',
    requires_host: 'Bit',
    site_code:     'VarChar',
    sort_order:    'SmallInt',
    is_active:     'Bit',
});

/**
 * @param {string[]} fields - Subconjunto de PATCH_DINER_GROUP_FIELDS.
 * @returns {string}
 */
function sqlPatchDinerGroup(fields) {
    const setClauses = [
        ...fields.map(f => `${f} = @${f}`),
        'updated_at             = SYSDATETIME()',
        'updated_by             = @updated_by',
        'updated_by_branch_code = @updated_by_branch_code',
    ];

    return `
        UPDATE GIPP.dbo.meal_diner_group
        SET ${setClauses.join(',\n            ')}
        WHERE id = @id;

        SELECT id, label, payee_id, billable, requires_host, site_code,
               sort_order, is_active, created_at, updated_at
        FROM GIPP.dbo.meal_diner_group
        WHERE id = @id;
    `;
}

// ─── Registro de refeição ────────────────────────────────────────────────────

/** Releitura por `client_uuid` — usada no caminho normal e no de corrida. */
const SELECT_MEAL_LOG_BY_CLIENT_UUID = `
        SELECT id, diner_type,
               company_code, employee_id, branch_code,
               diner_group_id, host_company_code, host_employee_id, host_branch_code,
               guest_label, cost_center, site_code,
               served_at, service_date,
               meal_type, identified_by, match_score,
               operator_user_id, client_uuid, synced_at
        FROM GIPP.dbo.meal_log
        WHERE client_uuid = @client_uuid;
`;

/**
 * Grava uma refeição, ou devolve a que já existe.
 *
 * O `WHERE NOT EXISTS` é o que torna a fila offline segura: reenviar o mesmo
 * `client_uuid` não duplica e não estoura erro. O `SELECT` no fim devolve
 * sempre a linha — a nova ou a que já estava lá — então o cliente não precisa
 * distinguir os dois casos para saber que a refeição está registrada.
 *
 * Corrida entre dois envios simultâneos do mesmo uuid ainda existe e é
 * resolvida pelo índice `UX_meal_log_client`; quem perder recebe erro 2601/2627
 * e o repositório reconsulta. Ver `insertMealLog` no repositório.
 */
function sqlInsertMealLog() {
    return `
        INSERT INTO GIPP.dbo.meal_log (
            diner_type,
            company_code, employee_id, branch_code,
            diner_group_id, host_company_code, host_employee_id, host_branch_code,
            guest_label, cost_center, site_code,
            served_at, service_date,
            meal_type, identified_by, match_score,
            operator_user_id, client_uuid, synced_at
        )
        SELECT
            @diner_type,
            @company_code, @employee_id, @branch_code,
            @diner_group_id, @host_company_code, @host_employee_id, @host_branch_code,
            @guest_label, @cost_center, @site_code,
            @served_at, @service_date,
            @meal_type, @identified_by, @match_score,
            @operator_user_id, @client_uuid, @synced_at
        WHERE NOT EXISTS (
            SELECT 1 FROM GIPP.dbo.meal_log WHERE client_uuid = @client_uuid
        );

        ${SELECT_MEAL_LOG_BY_CLIENT_UUID}
    `;
}

function sqlFindMealLogByClientUuid() {
    return SELECT_MEAL_LOG_BY_CLIENT_UUID;
}

/**
 * Quantas refeições uma pessoa fez numa data.
 *
 * Existe separada de `sqlFindDiner` para o caso em que a matrícula não está na
 * view — desligado fora da janela, ou cadastro sumido do Protheus — e ainda
 * assim existe histórico de refeição a reportar.
 */
function sqlCountMealsByDinerOnDate() {
    return `
        SELECT COUNT_BIG(*) AS meals_today
        FROM GIPP.dbo.meal_log
        WHERE company_code = @company_code
          AND employee_id  = @employee_id
          AND branch_code  = @branch_code
          AND service_date = @service_date;
    `;
}

/**
 * Confere se a filial existe no cadastro do Protheus.
 *
 * `CK_meal_log_site_code` garante o FORMATO (4 dígitos), não a existência — FK
 * entre `GIPP` e `TMPPRD12` não é possível no SQL Server. Esta é a checagem que
 * resta, e ela roda ao abrir a sessão do operador, não a cada refeição.
 */
function sqlBranchExists() {
    return `
        SELECT LTRIM(RTRIM(M0_CODFIL)) AS branch_code,
               LTRIM(RTRIM(M0_FILIAL)) AS branch_name,
               LTRIM(RTRIM(M0_NOME))   AS company_name
        FROM TMPPRD12.dbo.SYS_COMPANY
        WHERE LTRIM(RTRIM(M0_CODFIL)) = @branch_code
          AND D_E_L_E_T_ <> '*';
    `;
}

// ─── Relatórios (etapa 4) ────────────────────────────────────────────────────

/**
 * Refeições por dia e por loja.
 *
 * `service_date` é coluna real, gravada pela aplicação, não derivada de
 * `served_at` na consulta. É o que garante que uma mudança futura na regra do
 * corte de meia-noite não reescreva o passado.
 */
function sqlReportDaily() {
    return `
        SELECT service_date,
               site_code,
               COUNT_BIG(*)                                                AS total,
               SUM(CASE WHEN diner_type = 1 THEN 1 ELSE 0 END)              AS colaboradores,
               SUM(CASE WHEN diner_type = 2 THEN 1 ELSE 0 END)              AS grupos,
               SUM(CASE WHEN meal_type  = 1 THEN 1 ELSE 0 END)              AS almoco,
               SUM(CASE WHEN meal_type  = 2 THEN 1 ELSE 0 END)              AS jantar,
               SUM(CASE WHEN meal_type  = 3 THEN 1 ELSE 0 END)              AS cafe,
               SUM(CASE WHEN identified_by = 1 THEN 1 ELSE 0 END)           AS por_qr,
               SUM(CASE WHEN identified_by = 2 THEN 1 ELSE 0 END)           AS manual,
               SUM(CASE WHEN identified_by = 3 THEN 1 ELSE 0 END)           AS facial,
               SUM(CASE WHEN identified_by = 4 THEN 1 ELSE 0 END)           AS botao,
               SUM(CASE WHEN synced_at IS NOT NULL THEN 1 ELSE 0 END)       AS veio_da_fila
        FROM GIPP.dbo.meal_log
        WHERE service_date >= @date_from
          AND service_date <= @date_to
          AND (@site_code IS NULL OR site_code = @site_code)
        GROUP BY service_date, site_code
        ORDER BY service_date DESC, site_code;
    `;
}

/**
 * Rateio por centro de custo.
 *
 * ⚠️ O `GROUP BY` inclui `company_code` porque `RA_CC` **não é único entre as
 * empresas** — medido em 18/08/2026: o código 19900 (DIRETORIA) existe em 6
 * empresas, 1001 (LOJA) em 5, 1002 (GERAL) em 5, 17 códigos compartilhados no
 * total. Agrupar só por `cost_center` somaria a diretoria de seis empresas num
 * número só, e o erro não aparece como erro — aparece como rateio plausível.
 *
 * A descrição vem por `OUTER APPLY` sobre a view, e não por join: o `meal_log`
 * guarda só o código, de propósito (snapshot). Buscar a descrição na hora do
 * relatório é correto porque descrição é rótulo, não valor contábil.
 */
function sqlReportCostCenter() {
    return `
        WITH agregado AS (
            SELECT company_code,
                   cost_center,
                   COUNT_BIG(*)                                   AS total,
                   SUM(CASE WHEN diner_type = 1 THEN 1 ELSE 0 END) AS colaboradores,
                   SUM(CASE WHEN diner_type = 2 THEN 1 ELSE 0 END) AS grupos,
                   COUNT(DISTINCT service_date)                    AS dias_com_refeicao
            FROM GIPP.dbo.meal_log
            WHERE service_date >= @date_from
              AND service_date <= @date_to
              AND (@site_code IS NULL OR site_code = @site_code)
            GROUP BY company_code, cost_center
        )
        SELECT a.company_code,
               a.cost_center,
               cc.cost_center_description,
               a.total,
               a.colaboradores,
               a.grupos,
               a.dias_com_refeicao
        FROM agregado a
        OUTER APPLY (
            SELECT TOP 1 d.cost_center_description
            FROM GIPP.dbo.vw_meal_diner d
            WHERE d.company_code = a.company_code
              AND d.cost_center  = a.cost_center
        ) cc
        ORDER BY a.total DESC, a.company_code, a.cost_center;
    `;
}

/**
 * Refeições por contratante — a base do faturamento.
 *
 * Só `diner_type = 2`: colaborador do grupo não é faturado a terceiro. O
 * `billable` vem na projeção para o relatório separar o que se cobra do que só
 * se conta — visitante entra na contagem e não gera fatura.
 */
function sqlReportPayee() {
    return `
        SELECT dg.id                AS diner_group_id,
               dg.label,
               dg.billable,
               dg.payee_id,
               pe.name              AS payee_name,
               pe.document          AS payee_document,
               COUNT_BIG(*)         AS total,
               COUNT(DISTINCT ml.service_date) AS dias_com_refeicao,
               MIN(ml.service_date) AS primeira,
               MAX(ml.service_date) AS ultima
        FROM GIPP.dbo.meal_log ml
        INNER JOIN GIPP.dbo.meal_diner_group dg
                ON dg.id = ml.diner_group_id
        LEFT JOIN GIPP.dbo.gipp_payee pe
               ON pe.id = dg.payee_id
        WHERE ml.diner_type = 2
          AND ml.service_date >= @date_from
          AND ml.service_date <= @date_to
          AND (@site_code IS NULL OR ml.site_code = @site_code)
        GROUP BY dg.id, dg.label, dg.billable, dg.payee_id, pe.name, pe.document
        ORDER BY dg.billable DESC, COUNT_BIG(*) DESC;
    `;
}

/**
 * As duas exceções que a fase 1 existe para tratar.
 *
 * **Duplicatas** são CALCULADAS aqui, não gravadas. Não existe coluna
 * `is_duplicate` no `meal_log` de propósito: assim uma revisão da regra vale
 * também para o histórico. Hoje a regra é "mais de uma na mesma data civil".
 *
 * **Desligado servido** usa `terminated_at <= service_date`, e essa comparação é
 * o detalhe que importa. Filtrar só por `is_terminated = 1` marcaria como
 * irregular a refeição de agosto de quem foi desligado em setembro — a pessoa
 * estava ativa quando comeu. O relatório tem que apontar quem já estava
 * desligado NO DIA.
 */
function sqlReportDuplicates() {
    return `
        SELECT ml.service_date,
               ml.company_code,
               ml.employee_id,
               ml.branch_code,
               d.employee_name,
               ml.cost_center,
               COUNT_BIG(*)                    AS refeicoes,
               MIN(ml.served_at)               AS primeira,
               MAX(ml.served_at)               AS ultima,
               STRING_AGG(ml.site_code, ', ')  AS lojas
        FROM GIPP.dbo.meal_log ml
        OUTER APPLY (
            SELECT TOP 1 x.employee_name
            FROM GIPP.dbo.vw_meal_diner x
            WHERE x.company_code = ml.company_code
              AND x.employee_id  = ml.employee_id
              AND x.branch_code  = ml.branch_code
        ) d
        WHERE ml.diner_type = 1
          AND ml.service_date >= @date_from
          AND ml.service_date <= @date_to
          AND (@site_code IS NULL OR ml.site_code = @site_code)
        GROUP BY ml.service_date, ml.company_code, ml.employee_id, ml.branch_code,
                 d.employee_name, ml.cost_center
        HAVING COUNT_BIG(*) > 1
        ORDER BY COUNT_BIG(*) DESC, ml.service_date DESC;
    `;
}

function sqlReportTerminatedServed() {
    return `
        SELECT ml.service_date,
               ml.served_at,
               ml.site_code,
               ml.company_code,
               ml.employee_id,
               ml.branch_code,
               d.employee_name,
               d.terminated_at,
               ml.cost_center,
               DATEDIFF(DAY, d.terminated_at, ml.service_date) AS dias_apos_desligamento
        FROM GIPP.dbo.meal_log ml
        INNER JOIN GIPP.dbo.vw_meal_diner d
                ON d.company_code = ml.company_code
               AND d.employee_id  = ml.employee_id
               AND d.branch_code  = ml.branch_code
        WHERE ml.diner_type = 1
          AND ml.service_date >= @date_from
          AND ml.service_date <= @date_to
          AND (@site_code IS NULL OR ml.site_code = @site_code)
          AND d.is_terminated = 1
          AND d.terminated_at IS NOT NULL
          -- Já estava desligado NO DIA da refeição. Sem esta comparação, quem
          -- foi desligado depois apareceria como irregularidade retroativa.
          AND d.terminated_at <= ml.service_date
        ORDER BY ml.service_date DESC, d.employee_name;
    `;
}

module.exports = {
    sqlGetDinersForCache,
    sqlFindDiner,
    sqlGetDinerGroups,
    sqlFindDinerGroupById,
    sqlInsertDinerGroup,
    sqlPatchDinerGroup,
    sqlInsertMealLog,
    sqlFindMealLogByClientUuid,
    sqlCountMealsByDinerOnDate,
    sqlBranchExists,
    sqlReportDaily,
    sqlReportCostCenter,
    sqlReportPayee,
    sqlReportDuplicates,
    sqlReportTerminatedServed,
    PATCH_DINER_GROUP_FIELDS,
};
