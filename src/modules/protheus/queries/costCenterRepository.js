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
function sqlCompany() {
  return `SELECT * FROM (
              SELECT distinct
                LTRIM(RTRIM(CP.M0_CODIGO))  AS company_code,
                LTRIM(RTRIM(CP.M0_NOME))  AS company_name
              FROM TMPPRD12.dbo.SYS_COMPANY CP
              WHERE  CP.D_E_L_E_T_ <> '*'
          ) company ORDER BY company_name;`;
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


module.exports = {
  sqlCostCenter,
  sqlBranch,
  sqlCompany
};
