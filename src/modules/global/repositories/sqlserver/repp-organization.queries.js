/**
 * @fileoverview SQL de validação de empresa, filial e centro de custo no
 * Protheus (TMPPRD12) para a REPP. Roda no pool `config/protheus`.
 *
 * As mesmas fontes que a tela usa para montar os seletores
 * (`/protheus/companies`, `/branches/:code`, `/cost-centers/:code`), com
 * filtro por código e `D_E_L_E_T_` — validação não lista nada.
 *
 * Campos do Protheus vêm com padding à direita (`M0_CODFIL = '0201      '`).
 * A comparação `=` do SQL Server ignora espaço à direita, então o parâmetro
 * casa sem RTRIM na coluna (e o índice continua servindo).
 *
 * @module modules/global/repositories/sqlserver/repp-organization.queries
 */

const SQL_FIND_COMPANY = `
    SELECT TOP 1
           LTRIM(RTRIM(M0_CODIGO)) AS company_code,
           LTRIM(RTRIM(M0_NOME))   AS company_name
      FROM TMPPRD12.dbo.SYS_COMPANY
     WHERE D_E_L_E_T_ <> '*'
       AND M0_CODIGO = @company_code`;

/** A filial só é encontrada se pertencer à empresa informada. */
const SQL_FIND_BRANCH = `
    SELECT TOP 1
           LTRIM(RTRIM(M0_CODFIL)) AS branch_code,
           LTRIM(RTRIM(M0_FILIAL)) AS branch_name
      FROM TMPPRD12.dbo.SYS_COMPANY
     WHERE D_E_L_E_T_ <> '*'
       AND M0_CODIGO = @company_code
       AND M0_CODFIL = @branch_code`;

/**
 * Centro de custo da empresa. A tabela é por empresa (`CTT` + código + `0`)
 * — ver `modules/protheus/repositories/cost-center.queries.js`. O código da
 * empresa entra no NOME da tabela, então é revalidado aqui (2 dígitos) mesmo
 * já tendo passado pelo domínio: é o único ponto em que texto vira SQL.
 *
 * `TOP 1 ... ORDER BY CTT_FILIAL` porque o mesmo `CTT_CUSTO` pode existir em
 * mais de uma filial.
 *
 * @param {string} companyCode
 * @returns {string}
 */
function sqlFindCostCenter(companyCode) {
    if (!/^\d{2}$/.test(String(companyCode))) {
        throw new Error('company_code inválido: deve ter 2 dígitos.');
    }
    return `
    SELECT TOP 1
           LTRIM(RTRIM(CTT_CUSTO))  AS cost_center_code,
           LTRIM(RTRIM(CTT_DESC01)) AS cost_center_description
      FROM TMPPRD12.dbo.CTT${companyCode}0
     WHERE D_E_L_E_T_ <> '*'
       AND CTT_CUSTO = @cost_center_code
     ORDER BY CTT_FILIAL`;
}

module.exports = { SQL_FIND_COMPANY, SQL_FIND_BRANCH, sqlFindCostCenter };
