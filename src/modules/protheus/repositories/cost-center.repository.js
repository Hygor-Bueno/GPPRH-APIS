// repositório que apenas retorna SQL (padrão que você usa)
function sqlCostCenter(company_code) {
    return `
    SELECT
      LTRIM(RTRIM(CC.CTT_CUSTO)) AS costCenterCode,
      LTRIM(RTRIM(CC.CTT_DESC01)) AS costCenterDescription
    FROM TMPPRD12.dbo.CTT${company_code}0 CC
    ORDER BY CC.CTT_DESC01;
  `;
}
function sqlCompanyBranchByBranchCode(branch_code) {
    return `
    SELECT
        M0_CODIGO,
        M0_NOMECOM,
        M0_CODFIL,
        M0_FILIAL 
    FROM TMPPRD12.dbo.SYS_COMPANY WHERE M0_CODFIL = '${branch_code}';
  `;
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
function sqlMapUserWithOrganization(registration) {
    return `SELECT
                LTRIM(RTRIM(CC.CTT_CUSTO)) AS CTT_CUSTO,
                LTRIM(RTRIM(CC.CTT_DESC01)) AS CTT_DESC01,
                M0_CODIGO,
                M0_NOMECOM,
                M0_CODFIL,
                M0_FILIAL 

            FROM TMPPRD12.dbo.SRA020 RH

                INNER JOIN TMPPRD12.dbo.CTT020 CC
                ON RH.RA_CC = CC.CTT_CUSTO

                INNER JOIN TMPPRD12.dbo.SYS_COMPANY COMP
                ON RH.RA_FILIAL = COMP.M0_CODFIL

            WHERE	RH.RA_MAT LIKE '${registration}' AND 
                    RH.D_E_L_E_T_ <> '*' AND 
                    RH.RA_DEMISSA = '';`;
}

function sqlBranch(company_code) {
    return `SELECT
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
      AND M0_CODIGO = ${company_code}
      ORDER BY CP.M0_FILIAL;`;
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
function spInsertEmployeeCompensation({employee_id, compensation_id, value, branch_code, start_date, user }) {
    return `EXEC dbo.sp_gipp_insert_employee_compensation
    @employee_id = ${employee_id},
    @compensation_id = ${compensation_id},
    @value = ${value},
    @branch_code = ${branch_code},
    @start_date = ${start_date},
    @user = ${user}; `

}

module.exports = {
    sqlCostCenter,
    sqlBranch,
    sqlEmployeeData,
    sqlCompany,
    sqlCompanyBranchByBranchCode,
    sqlMapUserWithOrganization,
    spInsertEmployeeCompensation
};