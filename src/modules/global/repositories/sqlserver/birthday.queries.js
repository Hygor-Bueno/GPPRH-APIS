/**
 * @fileoverview Aniversariantes do mês, direto das tabelas de funcionário do Protheus.
 *
 * ⚠️ Por que não `view_employee_with_company_info`: a view não expõe `RA_NASC`
 *    nem `RA_SITFOLH`, e é exatamente isso que esta consulta precisa. Então ela
 *    faz o mesmo que a view — UNION das sete empresas (SRA010…SRA090), cada uma
 *    com o SEU centro de custo (CTT0x0), filtro de exclusão do Protheus — e
 *    acrescenta as duas colunas. Está na allowlist do
 *    `protheus-multiempresa.guard.test.js`. Se a view ganhar as colunas, migrar.
 *
 * Quem entra: não demitido (`RA_DEMISSA` vazio e `RA_SITFOLH <> 'D'`). Férias
 * (`F`) e afastado (`A`) continuam na lista, como no cartaz feito à mão.
 *
 * Roda no pool `config/sqlserver` (banco GIPP), que alcança o TMPPRD12.
 *
 * @module modules/global/repositories/sqlserver/birthday.queries
 */

/**
 * Uma SRA/CTT por empresa. Nomes escritos por extenso (e não montados do código
 * da empresa) para o guard multiempresa enxergar este arquivo.
 */
const COMPANY_TABLES = Object.freeze([
    { employees: 'SRA010', costCenters: 'CTT010' },
    { employees: 'SRA020', costCenters: 'CTT020' },
    { employees: 'SRA030', costCenters: 'CTT030' },
    { employees: 'SRA060', costCenters: 'CTT060' },
    { employees: 'SRA070', costCenters: 'CTT070' },
    { employees: 'SRA080', costCenters: 'CTT080' },
    { employees: 'SRA090', costCenters: 'CTT090' },
]);

function companySelect({ employees, costCenters }) {
    return `
            SELECT RTRIM(e.RA_FILIAL)   AS branch_code,
                   RTRIM(e.RA_MAT)      AS registration,
                   RTRIM(e.RA_NOME)     AS name,
                   RTRIM(e.RA_NOMECMP)  AS full_name,
                   e.RA_NASC            AS birth_date,
                   RTRIM(cc.CTT_DESC01) AS cost_center
              FROM TMPPRD12.dbo.${employees} e
              LEFT JOIN TMPPRD12.dbo.${costCenters} cc
                ON cc.CTT_CUSTO = e.RA_CC
               AND cc.D_E_L_E_T_ <> '*'
             WHERE e.D_E_L_E_T_ <> '*'
               AND LTRIM(RTRIM(e.RA_DEMISSA)) = ''
               AND e.RA_SITFOLH <> 'D'
               AND SUBSTRING(e.RA_NASC, 5, 2) = @month`;
}

/**
 * @param {number} branchCount - quantos parâmetros `@branch0..@branchN`; 0 = todas.
 * @returns {string}
 */
function sqlFindBirthdaysByMonth(branchCount = 0) {
    const branchFilter = branchCount > 0
        ? `WHERE u.branch_code IN (${Array.from({ length: branchCount }, (_, i) => `@branch${i}`).join(', ')})`
        : '';
    return `
        SELECT u.branch_code,
               RTRIM(cp.M0_FILIAL) AS branch_name,
               u.registration,
               u.name,
               u.full_name,
               u.birth_date,
               u.cost_center
          FROM (${COMPANY_TABLES.map(companySelect).join('\n            UNION ALL')}
          ) u
          LEFT JOIN TMPPRD12.dbo.SYS_COMPANY cp
            ON cp.M0_CODFIL = u.branch_code
           AND cp.D_E_L_E_T_ <> '*'
        ${branchFilter}
         ORDER BY u.branch_code, SUBSTRING(u.birth_date, 7, 2), u.full_name;`;
}

module.exports = { sqlFindBirthdaysByMonth };
