// repositório que apenas retorna SQL (padrão que você usa)
function sqlCostCenter() {
  return `
    SELECT
      LTRIM(RTRIM(CC.CTT_CUSTO)) AS CostCenterCode,
      LTRIM(RTRIM(CC.CTT_DESC01)) AS CostCenterDescription
    FROM TMPPRD12.dbo.CTT020 CC
    ORDER BY CC.CTT_DESC01;
  `;
}

function sqlBranch() {
  return `
    SELECT
      LTRIM(RTRIM(CP.M0_CODIGO)) AS CompanyCode,
      LTRIM(RTRIM(CP.M0_FILIAL)) AS CompanyName,
      LTRIM(RTRIM(CP.M0_CODFIL)) AS BranchCode,
      LTRIM(RTRIM(CP.M0_FILIAL)) AS BranchName,
      LTRIM(RTRIM(CP.M0_ENDENT)) AS BranchAddress,
      LTRIM(RTRIM(CP.M0_BAIRENT)) AS BranchNeighborhood,
      LTRIM(RTRIM(CP.M0_CIDENT)) AS BranchCity
    FROM TMPPRD12.dbo.SYS_COMPANY CP
    ORDER BY CP.M0_FILIAL;
  `;
}

function sqlBranchByCode() {
  return `
    SELECT
      LTRIM(RTRIM(CP.M0_CODIGO)) AS CompanyCode,
      LTRIM(RTRIM(CP.M0_FILIAL)) AS CompanyName,
      LTRIM(RTRIM(CP.M0_CODFIL)) AS BranchCode,
      LTRIM(RTRIM(CP.M0_FILIAL)) AS BranchName,
      LTRIM(RTRIM(CP.M0_ENDENT)) AS BranchAddress,
      LTRIM(RTRIM(CP.M0_BAIRENT)) AS BranchNeighborhood,
      LTRIM(RTRIM(CP.M0_CIDENT)) AS BranchCity
    FROM TMPPRD12.dbo.SYS_COMPANY CP
    WHERE CP.M0_CODFIL = @code
    ORDER BY CP.M0_FILIAL;
  `;
}

module.exports = {
  sqlCostCenter,
  sqlBranch,
  sqlBranchByCode
};
