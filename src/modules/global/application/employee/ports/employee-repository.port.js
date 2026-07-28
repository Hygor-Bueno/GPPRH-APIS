/**
 * @fileoverview Porta (contrato) de persistência MySQL — Employee.
 * @module modules/global/application/employee/ports/employee-repository.port
 */

class EmployeeRepositoryPort {
    /**
     * @param {{page:number, pageSize:number, employeeName:?string, companyId:?number, shopId:?number, subDepartmentId:?number, departmentId:?number, applicationAccess:?number}} params
     * @returns {Promise<{rows:object[], totalRecords:number, limitPage:number}>}
     */
    findEmployeesFiltered(params) { throw new Error('Not implemented'); }

    /**
     * @param {{page:number, pageSize:number, name:?string, applicationId:?number, status:?number}} params
     * @returns {Promise<{rows:object[], totalRecords:number, limitPage:number}>}
     */
    findUsersFiltered(params) { throw new Error('Not implemented'); }

    /** @param {number} employeeId @returns {Promise<object|null>} registro de `_files`, ou null se não houver foto */
    findPhotoRecord(employeeId) { throw new Error('Not implemented'); }

    /**
     * Salva o arquivo via FileService e vincula em `_user.file_id`.
     * @param {number} employeeId @param {Express.Multer.File} file @param {number} actingUserId
     * @returns {Promise<{affectedRows:number}>}
     */
    attachPhoto(employeeId, file, actingUserId) { throw new Error('Not implemented'); }
}

module.exports = { EmployeeRepositoryPort };
