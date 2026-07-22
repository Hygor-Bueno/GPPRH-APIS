/**
 * @fileoverview Repositório de colaboradores.
 * @module modules/global/repositories/mysql/employee.repository
 */

'use strict';

/** Tamanho de página padrão para listagem paginada. */
const PAGE_SIZE = 10;

/**
 * Chama a stored procedure `prcGetEmployeeDetails` com filtros opcionais.
 *
 * @param {number} page
 * @param {number} pageSize
 * @param {string|null} employeeName
 * @param {number|null} companyId
 * @param {number|null} shopId
 * @param {number|null} departmentId
 * @param {number|null} subDepartmentId
 * @param {number|null} applicationAccess
 * @returns {string}
 */
function sqlGetEmployeesFiltered() {
    return `CALL prcGetEmployeeDetails(?, ?, ?, ?, ?, ?, ?, ?)`;
}

function sqlGetUsersFiltered() {
    return `CALL sp_global_get_users(?, ?, ?, ?, ?)`;
}

module.exports = { sqlGetEmployeesFiltered, sqlGetUsersFiltered, PAGE_SIZE };
