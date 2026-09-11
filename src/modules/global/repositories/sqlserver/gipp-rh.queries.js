// ─── gipp-rh.repository.js ────────────────────────────────────────────────────
// Repositório SQL Server para o módulo global de RH do GIPP.
// Contém todas as queries relacionadas a compensações, beneficiários,
// recibos de pagamento e listagem de colaboradores.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Compensações ─────────────────────────────────────────────────────────────

/**
 * Retorna todas as compensações ativas com dados do colaborador e empresa.
 * Filtra registros sem data de encerramento (end_date IS NULL).
 * @returns {string} Query SQL
 */
function sqlActiveBeneficiaries() {
    return `SELECT
                rh.EmployeeName as name,
                comp.M0_FULNAME as comapany_name,
                comp.M0_FILIAL as branch_name,
                ec.*,
                c.description as compensation_description
            FROM
                GIPP.dbo.gipp_rh_employee_compensation ec

                INNER JOIN GIPP.dbo.gipp_rh_compensation c
                ON c.id = ec.compensation_id

                -- view_employee_with_company_info já unifica as 7 tabelas do
                -- Protheus (SRA010..SRA090) e aplica o filtro de exclusão. Antes
                -- daqui havia SRA020 fixo, que é só a empresa 02 — e por ser
                -- INNER JOIN o beneficiário das outras empresas não aparecia
                -- errado, desaparecia da listagem.
                INNER JOIN GIPP.dbo.view_employee_with_company_info rh
                ON rh.EmployeeID = ec.employee_id
                AND rh.BranchCode = ec.branch_code

                INNER JOIN TMPPRD12.dbo.SYS_COMPANY comp
                ON comp.M0_CODFIL = ec.branch_code

            WHERE end_date is null;`;
}

/**
 * Retorna todas as compensações cadastradas, ordenadas por ID decrescente.
 * @returns {string} Query SQL
 */
function sqlEmployeesCompensations() {
    return "select * from  GIPP.dbo.gipp_rh_compensation order by id desc;";
}

/**
 * Retorna o nome da stored procedure responsável pela atualização de compensação.
 * @returns {string} Nome da procedure
 */
function sqlUpdateCompensation() {
    return 'sp_update_gipp_rh_compensation';
}

/**
 * Insere uma nova compensação e retorna o registro criado via OUTPUT.
 * @returns {string} Query SQL de INSERT
 */
function sqlInsertCompensation() {
    return `
        INSERT INTO GIPP.dbo.gipp_rh_compensation (
            name,
            description,
            active,

            created_by,
            created_by_branch
        )
        OUTPUT INSERTED.*
        VALUES (
            @name,
            @description,
            @active,

            @created_by,
            @created_by_branch
        )
    `;
}

// ─── Colaboradores ────────────────────────────────────────────────────────────

/**
 * Executa a stored procedure de listagem paginada de colaboradores.
 * Suporta filtros por nome, centro de custo, filial, CNPJ e status.
 * @returns {string} Query SQL de EXEC
 */
function sqlGetEmployeesPaginated() {
    return `
        EXEC dbo.pcr_get_employees_paginated
            @PageNumber = @PageNumber,
            @PageSize = @PageSize,
            @EmployeeName = @EmployeeName,
            @CostCenterCode = @CostCenterCode,
            @BranchCode = @BranchCode,
            @CompanyCNPJ = @CompanyCNPJ,
            @Status = @Status
    `;
}

// ─── Recibos — Geração de PDF ─────────────────────────────────────────────────

/**
 * Gera a query para buscar dados de recibo de um colaborador ou prestador,
 * formatados para geração de PDF. Suporta filtro por período (YYYYMM).
 *
 * A query usa CTE + subquery correlacionada com FOR JSON PATH para agregar
 * os itens de cada recibo em um único campo JSON por receipt_group_id.
 *
 * Aplica is_active = 1 para excluir recibos desativados.
 *
 * @param {string|null} employeeCode - Matrícula do colaborador CLT
 * @param {string|null} branchCode   - Código da filial
 * @param {string|null} referenceInit - Referência inicial YYYYMM
 * @param {string|null} referenceEnd  - Referência final YYYYMM
 * @param {number|null} payeeId       - ID do prestador de serviço
 * @returns {{ sql: string, params: object }} Query e parâmetros
 */
function sqlGetBeneficiariesByEmployee(employeeCode, branchCode, referenceInit, referenceEnd, payeeId) {
    const params = {};
    let where = [];

    // Prioriza payee_id; se ausente, usa employee_code
    if (payeeId)           { where.push(`rec.payee_id = @payeeId`);             params.payeeId      = payeeId; }
    else if (employeeCode) { where.push(`rec.employee_code = @employeeCode`);   params.employeeCode = employeeCode; }
    if (branchCode)        { where.push(`rec.branch_code = @branchCode`);       params.branchCode   = branchCode; }
    if (referenceInit) {
        // Filtra por período; se referenceEnd não informado, busca apenas o mês inicial
        where.push(`rec.reference BETWEEN @referenceInit AND @referenceEnd`);
        params.referenceInit = referenceInit;
        params.referenceEnd  = referenceEnd || referenceInit;
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const sql = `
        WITH base AS (
            SELECT
                rec.id,
                rec.receipt_group_id,
                rec.employee_code,
                rec.payee_id,
                LTRIM(RTRIM(rec.employee_name)) AS employee_name,
                rec.reference,
                rec.description,
                rec.amount,
                rec.movement_type,
                rec.created_at,

                LTRIM(RTRIM(comp.M0_NOME)) AS company,
                comp.M0_CGC AS cnpj,

                -- Monta endereço completo da empresa
                LTRIM(RTRIM(comp.M0_ENDENT)) + ' - ' +
                LTRIM(RTRIM(comp.M0_BAIRENT)) + ' - ' +
                LTRIM(RTRIM(comp.M0_CIDENT)) + '/' +
                LTRIM(RTRIM(comp.M0_ESTENT)) + ' - CEP: ' +
                LTRIM(RTRIM(comp.M0_CEPENT)) AS endereco,

                emp.CostCenterDescription AS funcao

            FROM GIPP.dbo.gipp_payment_receipt rec

            INNER JOIN TMPPRD12.dbo.SYS_COMPANY comp
                ON comp.M0_CODFIL = rec.branch_code
                AND comp.D_E_L_E_T_ != '*'

            -- Colaborador CLT (opcional — prestador não tem vínculo no Protheus).
            -- A view unifica as 7 tabelas do Protheus e já traz o centro de custo,
            -- o que dispensa o join em CTT. Antes daqui havia SRA020 + CTT020
            -- fixos, que são só da empresa 02: colaborador de outra empresa não
            -- era encontrado e o recibo saía sem nome e com função "Prestador de
            -- Serviço" mesmo sendo CLT.
            --
            -- RA_FILIAL no join não é redundante: sem ele a mesma matrícula em
            -- outra filial casa e o recibo pode trazer o nome de outra pessoa.
            -- BranchCode no join não é redundante: sem ele a mesma matrícula em
            -- outra filial casa e o recibo pode trazer o nome de outra pessoa.
            LEFT JOIN GIPP.dbo.view_employee_with_company_info emp
                ON emp.EmployeeID    = rec.employee_code
                AND emp.BranchCode   = rec.branch_code
                AND emp.EmployeeDemiss = ''

            -- Aplica filtros dinâmicos + garante que apenas recibos ativos apareçam no PDF
            ${whereClause}${whereClause ? ' AND' : 'WHERE'} rec.is_active = 1
        )

        SELECT DISTINCT
            b.company AS empresa,
            b.endereco,
            b.cnpj,
            b.reference,
            RIGHT(b.reference, 2) + '/' + LEFT(b.reference, 4) AS mesReferencia,

            -- Usa matrícula do colaborador ou ID do prestador como identificador único
            COALESCE(b.employee_code, CAST(b.payee_id AS VARCHAR)) AS matricula,
            b.employee_name AS nome,
            ISNULL(b.funcao, 'Prestador de Serviço') AS funcao,

            -- Subquery correlacionada: agrupa os itens do mesmo recibo em JSON
            -- Ordena proventos (E) antes de descontos (D)
            JSON_QUERY((
                SELECT
                    b2.description AS descricao,
                    b.reference AS referencia,
                    CASE WHEN b2.movement_type = 'E' THEN b2.amount ELSE 0 END AS proventos,
                    CASE WHEN b2.movement_type = 'D' THEN b2.amount ELSE 0 END AS descontos
                FROM base b2
                WHERE b2.receipt_group_id = b.receipt_group_id
                ORDER BY
                    CASE WHEN b2.movement_type = 'E' THEN 1 ELSE 2 END,
                    b2.id
                FOR JSON PATH
            )) AS itens,

            CONVERT(VARCHAR(10), b.created_at, 103) AS dataStr

        FROM base b
        ORDER BY b.reference DESC
        FOR JSON PATH;
    `;
    return { sql, params };
}

// ─── Códigos de Evento ────────────────────────────────────────────────────────

/**
 * Retorna todos os códigos de evento cadastrados no Protheus (SRV020),
 * ordenados por descrição. Usados no lançamento manual de recibos.
 * @returns {string} Query SQL
 */
function sqlGetEventCodes() {
    return `SELECT RV_COD, RV_DESC FROM TMPPRD12.dbo.SRV020 ORDER BY RV_DESC;`;
}

// ─── Recibos de Pagamento — CRUD ──────────────────────────────────────────────

/**
 * Insere um novo recibo de pagamento.
 * Se receipt_group_id não for informado, gera um novo UUID via NEWID().
 * Retorna o registro completo inserido via SCOPE_IDENTITY.
 * @returns {string} Query SQL de INSERT
 */
function sqlInsertPaymentReceipt() {
    return `
        INSERT INTO GIPP.dbo.gipp_payment_receipt (
            company_code,
            branch_code,
            employee_code,
            payee_id,
            employee_name,
            branch_name,
            work_schedule_id,
            reference,
            reference_date,
            description,
            amount,
            movement_type,
            is_active,
            receipt_group_id,
            event_code,
            payment_type_id,
            created_at,
            created_by,
            created_by_branch_code
        )
        VALUES (
            @company_code,
            @branch_code,
            @employee_code,
            @payee_id,
            @employee_name,
            @branch_name,
            @work_schedule_id,
            @reference,
            ISNULL(@reference_date, GETDATE()),
            @description,
            @amount,
            @movement_type,
            @is_active,
            ISNULL(@receipt_group_id, NEWID()),
            @event_code,
            @payment_type_id,
            GETDATE(),
            @created_by,
            @created_by_branch_code
        );

        SELECT * FROM GIPP.dbo.gipp_payment_receipt WHERE id = SCOPE_IDENTITY();
    `;
}

/**
 * Busca recibos de pagamento com filtros opcionais dinâmicos.
 * Usado na tela de gestão — retorna registros ativos E inativos
 * (sem filtro de is_active por padrão).
 *
 * @param {object} filters - Filtros opcionais
 * @param {number}  [filters.id]
 * @param {string}  [filters.employee_code]
 * @param {string}  [filters.branch_code]
 * @param {string}  [filters.reference]       - Formato YYYYMM
 * @param {string}  [filters.description]     - Busca parcial via LIKE
 * @param {number}  [filters.amount]
 * @param {string}  [filters.movement_type]   - 'E' = Provento, 'D' = Desconto
 * @param {0|1}     [filters.is_active]
 * @param {number}  [filters.payment_type_id]
 * @param {string}  [filters.work_schedule_id]
 * @param {string}  [filters.reference_date]   - Data exata YYYY-MM-DD
 * @param {string}  [filters.date_from]        - Início do intervalo YYYY-MM-DD
 * @param {string}  [filters.date_to]          - Fim do intervalo YYYY-MM-DD
 * @returns {{ sql: string, params: object }} Query e parâmetros
 */
function sqlGetPaymentReceipts(filters) {
    const params = {};
    const where  = [];

    if (filters.id               !== undefined) { where.push('c.id = @id');                              params.id               = filters.id; }
    if (filters.employee_code    !== undefined) { where.push('c.employee_code = @employee_code');        params.employee_code    = filters.employee_code; }
    if (filters.branch_code      !== undefined) { where.push('c.branch_code = @branch_code');            params.branch_code      = filters.branch_code; }
    if (filters.reference        !== undefined) { where.push('c.reference = @reference');                params.reference        = filters.reference; }
    if (filters.description      !== undefined) { where.push('c.description LIKE @description');         params.description      = `%${filters.description}%`; }
    if (filters.amount           !== undefined) { where.push('c.amount = @amount');                      params.amount           = filters.amount; }
    if (filters.movement_type    !== undefined) { where.push('c.movement_type = @movement_type');        params.movement_type    = filters.movement_type; }
    if (filters.is_active        !== undefined) { where.push('c.is_active = @is_active');                params.is_active        = filters.is_active; }
    if (filters.payment_type_id  !== undefined) { where.push('c.payment_type_id = @payment_type_id');   params.payment_type_id  = filters.payment_type_id; }
    if (filters.work_schedule_id !== undefined) { where.push('c.work_schedule_id = @work_schedule_id');  params.work_schedule_id = filters.work_schedule_id; }
    if (filters.reference_date   !== undefined) { where.push('CAST(c.reference_date AS DATE) = @reference_date'); params.reference_date = filters.reference_date; }
    if (filters.date_from        !== undefined) { where.push('CAST(c.reference_date AS DATE) >= @date_from');     params.date_from      = filters.date_from; }
    if (filters.date_to          !== undefined) { where.push('CAST(c.reference_date AS DATE) <= @date_to');       params.date_to        = filters.date_to; }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const sql = `
        SELECT
            c.id,
            c.company_code,
            c.branch_code,
            c.branch_name,
            c.employee_code,
            LTRIM(RTRIM(c.employee_name)) AS employee_name,
            c.work_schedule_id,
            c.reference,
            c.reference_date,
            c.description,
            c.amount,
            c.movement_type,
            c.is_active,
            c.receipt_group_id,
            c.event_code,
            c.payment_type_id,
            c.created_at,
            c.created_by,
            c.created_by_branch_code,
            c.updated_at,
            c.updated_by,
            c.updated_by_branch_code
        FROM GIPP.dbo.gipp_payment_receipt c
        ${whereClause}
        ORDER BY c.id DESC;
    `;

    return { sql, params };
}

/**
 * Atualiza um recibo de pagamento pelo ID (substituição completa dos campos editáveis).
 * Registra data e usuário da atualização automaticamente.
 * Retorna o registro atualizado.
 * @returns {string} Query SQL de UPDATE
 */
function sqlUpdatePaymentReceipt() {
    return `
        UPDATE GIPP.dbo.gipp_payment_receipt
        SET
            description            = @description,
            amount                 = @amount,
            movement_type          = @movement_type,
            is_active              = @is_active,
            reference_date         = ISNULL(@reference_date, reference_date),
            event_code             = @event_code,
            work_schedule_id       = @work_schedule_id,
            payment_type_id        = @payment_type_id,
            updated_at             = GETDATE(),
            updated_by             = @updated_by,
            updated_by_branch_code = @updated_by_branch_code
        WHERE id = @id;

        SELECT * FROM GIPP.dbo.gipp_payment_receipt WHERE id = @id;
    `;
}

/**
 * Mapeamento de campos permitidos no PATCH com seus tipos SQL.
 * Usado pelo service para fazer o bind dinâmico dos parâmetros.
 * @type {Object.<string, string>}
 */
const PATCH_RECEIPT_FIELDS = {
    description:      'VarChar',
    amount:           'Decimal',
    movement_type:    'Char',
    is_active:        'Bit',
    reference_date:   'Date',
    event_code:       'VarChar',
    work_schedule_id: 'VarChar',
    payment_type_id:  'Int'
};

/**
 * Gera dinamicamente um UPDATE parcial (PATCH) com apenas os campos enviados.
 * Sempre inclui os campos de auditoria (updated_at, updated_by, updated_by_branch_code).
 * Retorna o registro atualizado.
 *
 * @param {string[]} fields - Nomes dos campos a atualizar (exceto id e auditoria)
 * @returns {string} Query SQL de UPDATE dinâmico
 */
function sqlPatchPaymentReceipt(fields) {
    const setClauses = [
        ...fields.map(f => `${f} = @${f}`),
        'updated_at             = GETDATE()',
        'updated_by             = @updated_by',
        'updated_by_branch_code = @updated_by_branch_code'
    ];

    return `
        UPDATE GIPP.dbo.gipp_payment_receipt
        SET ${setClauses.join(',\n            ')}
        WHERE id = @id;

        SELECT * FROM GIPP.dbo.gipp_payment_receipt WHERE id = @id;
    `;
}

// ─── Recibos — Listagem Consolidada ──────────────────────────────────────────

/**
 * Busca recibos consolidados para exibição na tela de listagem do colaborador.
 * Agrupa os itens do mesmo recibo calculando o valor líquido total (proventos - descontos).
 * Aplica is_active = 1 — apenas recibos ativos são exibidos.
 * Usa MIN(created_at) para evitar duplicatas quando há múltiplos itens por grupo.
 *
 * @param {string|null} employeeCode   - Matrícula do colaborador
 * @param {string|null} branchCode     - Código da filial
 * @param {string|null} referenceInit  - Referência inicial YYYYMM
 * @param {string|null} referenceTwo   - Referência final YYYYMM
 * @param {number|null} paymentTypeId  - Tipo de pagamento (ex: 1=salário, 6=fechamento GIPP)
 * @returns {{ sql: string, params: object }} Query e parâmetros
 */
function sqlGetReceipt(employeeCode, branchCode, referenceInit, referenceTwo, paymentTypeId, dateFrom, dateTo, workScheduleStatus) {
    const params = {};
    let where = [];

    if (employeeCode)  { where.push(`c.employee_code = @employeeCode`);                              params.employeeCode  = employeeCode; }
    if (branchCode)    { where.push(`c.branch_code = @branchCode`);                                  params.branchCode    = branchCode; }
    if (paymentTypeId) { where.push(`c.payment_type_id = @paymentTypeId`);                           params.paymentTypeId = paymentTypeId; }
    if (referenceInit) {
        where.push(`c.reference BETWEEN @referenceInit AND @referenceTwo`);
        params.referenceInit = referenceInit;
        params.referenceTwo  = referenceTwo || referenceInit;
    }
    if (dateFrom) { where.push(`CAST(c.reference_date AS DATE) >= @dateFrom`); params.dateFrom = dateFrom; }
    if (dateTo)   { where.push(`CAST(c.reference_date AS DATE) <= @dateTo`);   params.dateTo   = dateTo; }

    // Filtro por status da jornada — a tesouraria separa o que está em aberto
    // (6, Pagando) do que já foi encerrado (4, Finalizado, para reimpressão).
    //
    // O JOIN é LEFT de propósito: recibo de Salário, Férias, Rescisão, Bônus e
    // Adiantamento não tem jornada vinculada (`work_schedule_id` nulo). Com
    // INNER JOIN esses recibos desapareceriam da listagem — hoje são 74.
    if (workScheduleStatus) {
        where.push(`ws.id_status_fk = @workScheduleStatus`);
        params.workScheduleStatus = workScheduleStatus;
    }

    // Sempre filtra apenas recibos ativos na listagem
    where.push('c.is_active = 1');
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const sql = `
        SELECT
            c.payee_id,
            c.employee_code,
            c.employee_name          AS name,
            c.branch_code,
            c.branch_name,
            c.company_code,
            comp.M0_NOMECOM          AS company_name,
            c.reference,
            c.receipt_group_id,
            c.work_schedule_id,
            ws.id_status_fk          AS work_schedule_status,
            st.name                  AS work_schedule_status_name,
            c.payment_type_id,
            pt.description           AS payment_type,
            -- MIN evita duplicatas quando múltiplos itens têm created_at ligeiramente diferentes
            MIN(c.created_at)        AS created_at,
            MIN(c.reference_date)    AS reference_date,
            -- Soma líquida: proventos positivos, descontos negativos
            SUM(
                CASE
                    WHEN c.movement_type = 'E' THEN  c.amount
                    WHEN c.movement_type = 'D' THEN -c.amount
                    ELSE 0
                END
            ) AS amount
        FROM GIPP.dbo.gipp_payment_receipt c
            LEFT JOIN TMPPRD12.dbo.SYS_COMPANY comp
                ON comp.M0_CODFIL   = c.branch_code
               AND comp.D_E_L_E_T_ <> '*'
            LEFT JOIN GIPP.dbo.gipp_payment_type pt
                ON pt.id = c.payment_type_id
            LEFT JOIN GIPP.dbo.cf_work_schedules ws
                ON ws.cod_work_schedule = c.work_schedule_id
            LEFT JOIN GIPP.dbo.cf_status st
                ON st.id_status = ws.id_status_fk
        ${whereClause}
        GROUP BY
            c.payee_id,
            c.employee_code,
            c.employee_name,
            c.reference,
            c.branch_code,
            comp.M0_NOMECOM,
            c.payment_type_id,
            c.company_code,
            pt.description,
            c.branch_name,
            c.receipt_group_id,
            c.work_schedule_id,
            ws.id_status_fk,
            st.name
        ORDER BY c.reference DESC, c.work_schedule_id;
    `;
    return { sql, params };
}

// ─── Tipos de Pagamento ───────────────────────────────────────────────────────

/**
 * Retorna todos os tipos de pagamento cadastrados, ordenados por ID.
 * Ex: 1 = Salário, 6 = Fechamento de Jornada GIPP.
 * @returns {string} Query SQL
 */
function sqlGetPaymentTypes() {
    return `
        SELECT id, description
        FROM GIPP.dbo.gipp_payment_type
        ORDER BY id;
    `;
}

// ─── Recibos — Geração de PDF por Group ID ────────────────────────────────────

/**
 * Gera a query para buscar e formatar recibos para PDF a partir de uma
 * lista de receipt_group_ids. Esta é a rota principal de geração de PDF,
 * substituindo as antigas receipt-batch e receipt-by-work-schedule.
 *
 * Agrupa por receipt_group_id usando GROUP BY + MIN(created_at) para evitar
 * duplicatas (itens do mesmo grupo são inseridos sequencialmente com GETDATE(),
 * gerando timestamps ligeiramente diferentes).
 *
 * Aplica is_active = 1 para excluir recibos desativados.
 * Retorna resultado serializado como JSON via FOR JSON PATH.
 *
 * @param {string[]} groupIds - Lista de UUIDs de receipt_group_id
 * @returns {{ sql: string, params: object }} Query e parâmetros nomeados
 */
function sqlGetReceiptsByGroupIds(groupIds) {
    const params = {};
    // Cria parâmetros nomeados dinâmicos: @rg0, @rg1, @rg2...
    const keys = groupIds.map((id, i) => {
        params[`rg${i}`] = id;
        return `@rg${i}`;
    });

    const sql = `
        WITH base AS (
            SELECT
                rec.id,
                rec.receipt_group_id,
                rec.employee_code,
                rec.payee_id,
                LTRIM(RTRIM(rec.employee_name))   AS employee_name,
                rec.branch_code,
                rec.reference,
                rec.description,
                rec.amount,
                rec.movement_type,
                rec.created_at,

                LTRIM(RTRIM(comp.M0_NOME))        AS company,
                comp.M0_CGC                        AS cnpj,

                -- Endereço completo concatenado da empresa
                LTRIM(RTRIM(comp.M0_ENDENT)) + ' - ' +
                LTRIM(RTRIM(comp.M0_BAIRENT)) + ' - ' +
                LTRIM(RTRIM(comp.M0_CIDENT)) + '/' +
                LTRIM(RTRIM(comp.M0_ESTENT)) + ' - CEP: ' +
                LTRIM(RTRIM(comp.M0_CEPENT))      AS endereco,

                -- Função/cargo via centro de custo (apenas colaboradores CLT)
                emp.CostCenterDescription          AS funcao

            FROM GIPP.dbo.gipp_payment_receipt rec

            INNER JOIN TMPPRD12.dbo.SYS_COMPANY comp
                ON comp.M0_CODFIL   = rec.branch_code
               AND comp.D_E_L_E_T_ != '*'

            -- Colaboradores CLT (prestadores não possuem vínculo no Protheus).
            -- BranchCode filtra pela filial do recibo: evita produto cartesiano
            -- quando a mesma matrícula existe em mais de uma filial ativa.
            --
            -- A view unifica as 7 tabelas do Protheus (SRA010..SRA090) e já traz
            -- o centro de custo. Antes havia SRA020 + CTT020 fixos, que são só da
            -- empresa 02: a 0601 (empresa 06) imprimia recibo sem nome e com
            -- função "Prestador de Serviço" para colaborador CLT.
            LEFT JOIN GIPP.dbo.view_employee_with_company_info emp
                ON emp.EmployeeID      = rec.employee_code
               AND emp.BranchCode      = rec.branch_code
               AND emp.EmployeeDemiss  = ''

            WHERE rec.receipt_group_id IN (${keys.join(', ')})
              AND rec.is_active = 1
        )

        SELECT
            b.company       AS empresa,
            b.endereco,
            b.cnpj,
            b.branch_code,
            b.reference,
            RIGHT(b.reference, 2) + '/' + LEFT(b.reference, 4) AS mesReferencia,

            -- Identificador unificado: matrícula CLT ou ID do prestador
            COALESCE(b.employee_code, CAST(b.payee_id AS VARCHAR)) AS matricula,
            b.employee_name AS nome,
            ISNULL(b.funcao, 'Prestador de Serviço') AS funcao,

            -- Itens do recibo em JSON: proventos (E) ordenados antes de descontos (D)
            JSON_QUERY((
                SELECT
                    b2.description                                               AS descricao,
                    b.reference                                                  AS referencia,
                    CASE WHEN b2.movement_type = 'E' THEN b2.amount ELSE 0 END  AS proventos,
                    CASE WHEN b2.movement_type = 'D' THEN b2.amount ELSE 0 END  AS descontos
                FROM base b2
                WHERE b2.receipt_group_id = b.receipt_group_id
                ORDER BY
                    CASE WHEN b2.movement_type = 'E' THEN 1 ELSE 2 END,
                    b2.id
                FOR JSON PATH
            )) AS itens,

            -- MIN evita duplicata de data quando itens do mesmo grupo têm timestamps diferentes
            CONVERT(VARCHAR(10), MIN(b.created_at), 103) AS dataStr

        FROM base b
        -- GROUP BY receipt_group_id garante exatamente 1 linha (recibo) por grupo
        GROUP BY
            b.company,
            b.endereco,
            b.cnpj,
            b.branch_code,
            b.reference,
            b.employee_code,
            b.payee_id,
            b.employee_name,
            b.funcao,
            b.receipt_group_id
        ORDER BY COALESCE(b.employee_code, CAST(b.payee_id AS VARCHAR)), b.branch_code, b.reference DESC
        FOR JSON PATH;
    `;

    return { sql, params };
}

/**
 * Jornadas vinculadas aos recibos dos grupos informados, com o status atual.
 *
 * `gipp_payment_receipt.work_schedule_id` guarda o `cod_work_schedule` (VarChar),
 * não um id numérico — o join é direto. Recibo sem jornada (adiantamento) tem a
 * coluna nula e fica de fora: não há o que fechar.
 *
 * @param {string[]} groupIds
 * @returns {{sql: string, params: Record<string, string>}}
 */
function sqlGetWorkSchedulesByReceiptGroupIds(groupIds) {
    const params = {};
    const keys = groupIds.map((id, i) => {
        params[`rg${i}`] = id;
        return `@rg${i}`;
    });

    const sql = `
        SELECT DISTINCT
            ws.cod_work_schedule,
            ws.id_status_fk
        FROM GIPP.dbo.gipp_payment_receipt rec
        INNER JOIN GIPP.dbo.cf_work_schedules ws
            ON ws.cod_work_schedule = rec.work_schedule_id
        WHERE rec.receipt_group_id IN (${keys.join(', ')})
          AND rec.is_active = 1
          AND rec.work_schedule_id IS NOT NULL;
    `;

    return { sql, params };
}

module.exports = {
    sqlEmployeesCompensations,
    sqlActiveBeneficiaries,
    sqlInsertCompensation,
    sqlUpdateCompensation,
    sqlGetEmployeesPaginated,
    sqlGetBeneficiariesByEmployee,
    sqlGetReceipt,
    sqlGetReceiptsByGroupIds,
    sqlGetWorkSchedulesByReceiptGroupIds,
    sqlGetEventCodes,
    sqlInsertPaymentReceipt,
    sqlGetPaymentReceipts,
    sqlUpdatePaymentReceipt,
    sqlPatchPaymentReceipt,
    sqlGetPaymentTypes,
    PATCH_RECEIPT_FIELDS
};
