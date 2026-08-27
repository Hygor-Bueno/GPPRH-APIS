/**
 * @fileoverview Queries SQL puras — Employee.
 * @module modules/global/repositories/mysql/employee.queries
 */

'use strict';

/** Tamanho de página padrão para listagem paginada. */
const PAGE_SIZE = 10;

/** Chama a stored procedure `prcGetEmployeeDetails` com filtros opcionais. */
function sqlGetEmployeesFiltered() {
    return `CALL prcGetEmployeeDetails(?, ?, ?, ?, ?, ?, ?, ?)`;
}

function sqlGetUsersFiltered() {
    return `CALL sp_global_get_users(?, ?, ?, ?, ?)`;
}

const SQL_GET_USER_FILE_ID = `SELECT file_id FROM _user WHERE id = ?`;
const SQL_UPDATE_USER_FILE_ID = `UPDATE _user SET file_id = ? WHERE id = ?`;

module.exports = {
    sqlGetEmployeesFiltered,
    sqlGetUsersFiltered,
    SQL_GET_USER_FILE_ID,
    SQL_UPDATE_USER_FILE_ID,
    PAGE_SIZE,
};
