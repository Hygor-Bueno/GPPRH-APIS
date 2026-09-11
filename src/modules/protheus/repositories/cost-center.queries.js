// repositório que apenas retorna SQL (padrão que você usa)

/**
 * Empresas do Protheus e as tabelas de cada uma.
 *
 * No Protheus a tabela é por empresa: `SRA020` são os colaboradores da 02,
 * `SRA060` os da 06, e o centro de custo segue o mesmo sufixo. Não há 04 nem 05
 * nesta base.
 */
const COMPANY_TABLES = Object.freeze([
    { company: '01', employees: 'SRA010', costCenters: 'CTT010' },
    { company: '02', employees: 'SRA020', costCenters: 'CTT020' },
    { company: '03', employees: 'SRA030', costCenters: 'CTT030' },
    { company: '06', employees: 'SRA060', costCenters: 'CTT060' },
    { company: '07', employees: 'SRA070', costCenters: 'CTT070' },
    { company: '08', employees: 'SRA080', costCenters: 'CTT080' },
    { company: '09', employees: 'SRA090', costCenters: 'CTT090' },
]);

/**
 * Colaboradores de TODAS as empresas, já com o centro de custo resolvido.
 *
 * O resto do backend usa `GIPP.dbo.view_employee_with_company_info`, que faz
 * exatamente isto. Aqui não dá: as queries deste arquivo rodam no pool
 * `config/protheus` (usuário do Protheus), que **não tem permissão no banco
 * GIPP** — usar a view devolve "The server principal is not able to access the
 * database GIPP". Então o UNION reproduz a view dentro de TMPPRD12.
 *
 * Antes desta função havia `SRA020` e `CTT020` fixos, ou seja, só a empresa 02.
 * Como os JOIN eram INNER, colaborador das outras seis não vinha incompleto:
 * desaparecia do resultado, e quem chama lê isso como "não encontrado no
 * Protheus".
 *
 * OUTER APPLY com TOP 1 no centro de custo porque a mesma `CTT_CUSTO` existe em
 * várias filiais — um JOIN simples multiplicaria as linhas do colaborador.
 */
const EMPLOYEES_ALL_COMPANIES = COMPANY_TABLES.map(({ company, employees, costCenters }) => `
            SELECT
                '${company}'   AS company_code,
                RH.RA_MAT,
                RH.RA_FILIAL,
                RH.RA_DEMISSA,
                CC.CTT_CUSTO,
                CC.CTT_DESC01
            FROM TMPPRD12.dbo.${employees} RH
            OUTER APPLY (
                SELECT TOP 1 CTT_CUSTO, CTT_DESC01
                FROM TMPPRD12.dbo.${costCenters}
                WHERE CTT_CUSTO   = RH.RA_CC
                  AND D_E_L_E_T_ <> '*'
                ORDER BY CTT_FILIAL
            ) CC
            WHERE RH.D_E_L_E_T_ <> '*'`).join('\n            UNION ALL');

function sqlCostCenter(company_code) {
    if (!/^\d+$/.test(String(company_code))) {
        throw new Error('company_code inválido: deve ser numérico.');
    }
    return `
    SELECT
      LTRIM(RTRIM(CC.CTT_CUSTO)) AS costCenterCode,
      LTRIM(RTRIM(CC.CTT_DESC01)) AS costCenterDescription
    FROM TMPPRD12.dbo.CTT${company_code}0 CC
    ORDER BY CC.CTT_DESC01;
  `;
}
function sqlCompanyBranchByBranchCode(branch_code) {
    return {
        sql: `
    SELECT
        M0_CODIGO,
        M0_NOMECOM,
        M0_CODFIL,
        M0_FILIAL
    FROM TMPPRD12.dbo.SYS_COMPANY WHERE M0_CODFIL = @branch_code;
  `,
        params: { branch_code }
    };
}
function sqlCompany() {
    return `SELECT * FROM (
              SELECT distinct
                LTRIM(RTRIM(CP.M0_CODIGO))  AS company_code,
                LTRIM(RTRIM(CP.M0_NOME))  AS company_name
              FROM TMPPRD12.dbo.SYS_COMPANY CP
              WHERE  CP.D_E_L_E_T_ <> '*'
          ) company ORDER BY company_name;`;
}
/**
 * Empresa, filial e centro de custo de um colaborador — usada para montar a
 * sessão no login.
 *
 * `branch_code` não é opcional por gosto: a matrícula **não** é única entre
 * empresas nem entre filiais (a 000003 existe na 0601 e na 0901). Quem chama usa
 * a primeira linha, então sem a filial a sessão pode receber a empresa de outra
 * pessoa. Quando a filial vem, o resultado é uma linha determinística; quando não
 * vem, o ORDER BY ao menos torna a escolha estável entre execuções.
 *
 * @param {string} registration - Matrícula (aceita padrão de LIKE).
 * @param {?string} [branchCode] - Filial de 4 dígitos, quando conhecida.
 */
function sqlMapUserWithOrganization(registration, branchCode = null) {
    const params = { registration };
    let filtroFilial = '';

    if (branchCode) {
        params.branch_code = branchCode;
        filtroFilial = 'AND RH.RA_FILIAL = @branch_code';
    }

    return {
        sql: `SELECT
                LTRIM(RTRIM(RH.CTT_CUSTO)) AS CTT_CUSTO,
                LTRIM(RTRIM(RH.CTT_DESC01)) AS CTT_DESC01,
                M0_CODIGO,
                M0_NOMECOM,
                M0_CODFIL,
                M0_FILIAL

            FROM (${EMPLOYEES_ALL_COMPANIES}
            ) RH

                INNER JOIN TMPPRD12.dbo.SYS_COMPANY COMP
                ON RH.RA_FILIAL = COMP.M0_CODFIL
                AND COMP.D_E_L_E_T_ <> '*'

            WHERE RH.RA_MAT LIKE @registration AND
                    RH.RA_DEMISSA = ''
                    ${filtroFilial}
            ORDER BY RH.RA_FILIAL;`,
        params
    };
}

function sqlBranch(company_code) {
    return {
        sql: `SELECT
          LTRIM(RTRIM(CP.M0_CODIGO))  AS company_code,
          LTRIM(RTRIM(CP.M0_FILIAL))  AS company_name,
          LTRIM(RTRIM(CP.M0_CODFIL))  AS branch_code,
          LTRIM(RTRIM(CP.M0_FILIAL))  AS branch_name,
          LTRIM(RTRIM(CP.M0_ENDENT))  AS branch_address,
          LTRIM(RTRIM(CP.M0_BAIRENT)) AS branch_neighborhood,
          LTRIM(RTRIM(CP.M0_CIDENT))  AS branch_city,
          LTRIM(RTRIM(RTRIM(CP.M0_ESTENT))) AS branch_state,
          LTRIM(RTRIM(CP.M0_CEPENT))  AS branch_cep,
          CONCAT(
              NULLIF(LTRIM(RTRIM(CP.M0_ENDENT)), ''),
              CASE
                  WHEN NULLIF(LTRIM(RTRIM(CP.M0_BAIRENT)), '') IS NOT NULL THEN
                      CONCAT(', ', LTRIM(RTRIM(CP.M0_BAIRENT)))
                  ELSE ''
              END,
              CASE
                  WHEN NULLIF(LTRIM(RTRIM(CP.M0_CIDENT)), '') IS NOT NULL THEN
                      CONCAT(' - ', LTRIM(RTRIM(CP.M0_CIDENT)))
                  ELSE ''
              END,
              CASE
                  WHEN NULLIF(LTRIM(RTRIM(CP.M0_ESTENT)), '') IS NOT NULL THEN
                      CONCAT('/', LTRIM(RTRIM(CP.M0_ESTENT)))
                  ELSE ''
              END,
              CASE
                  WHEN NULLIF(LTRIM(RTRIM(CP.M0_CEPENT)), '') IS NOT NULL THEN
                      CONCAT(' - CEP ', LTRIM(RTRIM(CP.M0_CEPENT)))
                  ELSE ''
              END
          ) AS full_branch_address
      FROM TMPPRD12.dbo.SYS_COMPANY CP
      WHERE  CP.D_E_L_E_T_ <> '*'
      AND M0_CODIGO = @company_code
      ORDER BY CP.M0_FILIAL;`,
        params: { company_code }
    };
}

function sqlAllBranches() {
    return `SELECT
          LTRIM(RTRIM(CP.M0_CODIGO))  AS company_code,
          LTRIM(RTRIM(CP.M0_FILIAL))  AS company_name,
          LTRIM(RTRIM(CP.M0_CODFIL))  AS branch_code,
          LTRIM(RTRIM(CP.M0_FILIAL))  AS branch_name,
          LTRIM(RTRIM(CP.M0_ENDENT))  AS branch_address,
          LTRIM(RTRIM(CP.M0_BAIRENT)) AS branch_neighborhood,
          LTRIM(RTRIM(CP.M0_CIDENT))  AS branch_city,
          LTRIM(RTRIM(CP.M0_ESTENT))  AS branch_state,
          LTRIM(RTRIM(CP.M0_CEPENT))  AS branch_cep,
          CONCAT(
              NULLIF(LTRIM(RTRIM(CP.M0_ENDENT)), ''),
              CASE WHEN NULLIF(LTRIM(RTRIM(CP.M0_BAIRENT)), '') IS NOT NULL THEN CONCAT(', ', LTRIM(RTRIM(CP.M0_BAIRENT))) ELSE '' END,
              CASE WHEN NULLIF(LTRIM(RTRIM(CP.M0_CIDENT)), '') IS NOT NULL THEN CONCAT(' - ', LTRIM(RTRIM(CP.M0_CIDENT))) ELSE '' END,
              CASE WHEN NULLIF(LTRIM(RTRIM(CP.M0_ESTENT)), '') IS NOT NULL THEN CONCAT('/', LTRIM(RTRIM(CP.M0_ESTENT))) ELSE '' END,
              CASE WHEN NULLIF(LTRIM(RTRIM(CP.M0_CEPENT)), '') IS NOT NULL THEN CONCAT(' - CEP ', LTRIM(RTRIM(CP.M0_CEPENT))) ELSE '' END
          ) AS full_branch_address
      FROM TMPPRD12.dbo.SYS_COMPANY CP
      WHERE CP.D_E_L_E_T_ <> '*'
      ORDER BY LTRIM(RTRIM(CP.M0_FILIAL));`;
}


function sqlEmployeeData() {
    return `
    DECLARE @sql NVARCHAR(MAX) = '';

    SELECT @sql = @sql + '
        SELECT 
            ''' + TABLE_NAME + ''' AS TABELA,
            RH.RA_MAT,
            RH.RA_NOME,
            COMP.M0_CODIGO,
            COMP.M0_CODFIL
        FROM ' + TABLE_SCHEMA + '.' + TABLE_NAME + ' RH
        INNER JOIN TMPPRD12.dbo.SYS_COMPANY COMP
            ON COMP.M0_CODFIL = RH.RA_FILIAL
        WHERE COMP.D_E_L_E_T_ = ''''
        AND RH.D_E_L_E_T_ = ''''
        AND RH.RA_DEMISSA = ''''
        AND RH.RA_NOME COLLATE Latin1_General_CI_AI
            LIKE UPPER(REPLACE(@name,'' '',''%'')) + ''%''
        UNION ALL'
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE 'SRA[0-9][0-9][0-9]';

    SET @sql = LEFT(@sql, LEN(@sql) - LEN('UNION ALL'));

    SET @sql = @sql + ' ORDER BY RA_NOME';

    EXEC sp_executesql
        @sql,
        N'@name NVARCHAR(200)',
        @name;
    `;
}
function spInsertEmployeeCompensation({ employee_id, compensation_id, value, branch_code, start_date, user }) {
    return {
        sql: `EXEC dbo.sp_gipp_insert_employee_compensation
    @employee_id = @employee_id,
    @compensation_id = @compensation_id,
    @value = @value,
    @branch_code = @branch_code,
    @start_date = @start_date,
    @user = @user;`,
        params: { employee_id, compensation_id, value, branch_code, start_date, user }
    };
}

/**
 * Enriquece uma lista de usuários com dados do Protheus (empresa, filial, centro de custo).
 *
 * Parâmetros: um par de inputs (@r0/@f0, @r1/@f1, ... @r{n-1}/@f{n-1}) por
 * usuário — matrícula (RA_MAT) + filial (RA_FILIAL). A mesma matrícula pode
 * existir em mais de uma filial no Protheus (transferência entre filiais,
 * registro histórico); parear com a filial evita cruzar com o registro
 * errado (ex: um antigo, já demitido, de outra filial).
 *
 * @param {number} count - Quantidade de pares matrícula/filial
 * @returns {string} SQL com placeholders dinâmicos
 */
function sqlGetUserOrganizationBatch(count) {
    const conditions = Array.from({ length: count }, (_, i) => `(RH.RA_MAT = @r${i} AND RH.RA_FILIAL = @f${i})`).join(' OR ');
    return `
        SELECT
            LTRIM(RTRIM(RH.RA_MAT))       AS registration,
            LTRIM(RTRIM(RH.RA_DEMISSA))   AS ra_demissa,
            LTRIM(RTRIM(RH.CTT_CUSTO))    AS cost_center_code,
            LTRIM(RTRIM(RH.CTT_DESC01))   AS cost_center_description,
            LTRIM(RTRIM(COMP.M0_CODIGO))  AS company_code,
            LTRIM(RTRIM(COMP.M0_NOMECOM)) AS company_name,
            LTRIM(RTRIM(COMP.M0_CODFIL))  AS branch_code,
            LTRIM(RTRIM(COMP.M0_FILIAL))  AS branch_name,
            LTRIM(RTRIM(COMP.M0_CGC))     AS cnpj
        -- Todas as empresas: antes havia SRA020 + CTT020 fixos, e colaborador
        -- fora da empresa 02 simplesmente não vinha nesta lista — quem chama lê
        -- a ausência como "não encontrado no Protheus".
        --
        -- Segue sem filtrar demissão de propósito: ra_demissa vai no resultado
        -- para quem chama decidir.
        FROM (${EMPLOYEES_ALL_COMPANIES}
        ) RH
            INNER JOIN TMPPRD12.dbo.SYS_COMPANY COMP
                ON COMP.M0_CODFIL = RH.RA_FILIAL AND COMP.D_E_L_E_T_ <> '*'
        WHERE (${conditions})
    `;
}

module.exports = {
    sqlCostCenter,
    sqlBranch,
    sqlAllBranches,
    sqlEmployeeData,
    sqlCompany,
    sqlCompanyBranchByBranchCode,
    sqlMapUserWithOrganization,
    sqlGetUserOrganizationBatch,
    spInsertEmployeeCompensation
};