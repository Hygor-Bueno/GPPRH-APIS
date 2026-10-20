/**
 * @fileoverview Busca de funcionário por CPF na view unificada do Protheus.
 *
 * `GIPP.dbo.view_employee_with_company_info` junta as sete empresas (SRA010…
 * SRA090) — nunca consultar uma SRA0x0 direto (ver o guard
 * `protheus-multiempresa.guard.test.js`). Roda no pool `config/sqlserver`
 * (banco GIPP), que é o que alcança a view.
 *
 * O CPF é normalizado dos DOIS lados (só dígitos, 11 posições com zero à
 * esquerda): o Protheus guarda CHAR com padding à direita, e o relógio grava
 * os 11 últimos dígitos de um campo de 12.
 *
 * ⚠️ A view não expõe `RA_PIS`. Quem bate ponto identificado por PIS não é
 *    encontrado aqui — ver `domain/cppp/cpf.rules.js`.
 *
 * @module modules/global/repositories/sqlserver/cppp-employee.queries
 */

const NORMALIZED_CPF = `RIGHT('00000000000' + REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(EmployeeCPF)), '.', ''), '-', ''), ' ', ''), 11)`;

/**
 * @param {number} count - quantos parâmetros `@id0..@idN`.
 * @returns {string}
 */
function sqlFindEmployeesByCpf(count) {
    const params = Array.from({ length: count }, (_, i) => `@id${i}`).join(', ');
    return `
        SELECT ${NORMALIZED_CPF}           AS cpf,
               RTRIM(EmployeeID)           AS registration,
               RTRIM(EmployeeName)         AS name,
               RTRIM(EmployeeFullName)     AS full_name,
               RTRIM(BranchCode)           AS branch_code,
               RTRIM(BranchName)           AS branch_name,
               RTRIM(CompanyName)          AS company_name,
               RTRIM(CostCenterDescription) AS cost_center,
               EmployeeAdmiss              AS admitted,
               EmployeeDemiss              AS dismissed,
               EmployeeDayHours            AS day_hours
          FROM view_employee_with_company_info
         WHERE ${NORMALIZED_CPF} IN (${params})`;
}

module.exports = { sqlFindEmployeesByCpf };
