/**
 * @fileoverview Adapter MySQL — implementa `EmployeeRepositoryPort`.
 *
 * `FileService` é colaborador direto do adapter (como `poolGlobal`), sem port
 * dedicado — mesma decisão já tomada para Task Item/Message no GTPP.
 *
 * @module modules/global/infrastructure/employee/mysql-employee.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { FileService } = require('../../../../utils/file/file.service');
const { EmployeeRepositoryPort } = require('../../application/employee/ports/employee-repository.port');
const {
    sqlGetEmployeesFiltered,
    sqlGetUsersFiltered,
    SQL_GET_USER_FILE_ID,
    SQL_UPDATE_USER_FILE_ID,
} = require('../../repositories/mysql/employee.queries');

// `CCPP` é o módulo de colaboradores herdado do PHP (GLOBAL/Controller/CCPP/) e
// é onde o scripts/migrate-employee-photos.js gravou as 129 fotos migradas.
// Já esteve como 'EMPLOYEE', que criou um storage/uploads/EMPLOYEE/ paralelo —
// o validateModule só checa o regex /^[A-Z]{2,8}$/, então nada acusou o erro.
const EMPLOYEE_MODULE = 'CCPP';

/** Stored procedures retornam array de result sets — o primeiro é os dados. */
function extractRows(results) {
    return Array.isArray(results[0]) ? results[0] : results;
}

class MysqlEmployeeRepository extends EmployeeRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.execute(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'EMPLOYEE_MYSQL_ERROR',
                details: error,
            });
        }
    }

    async findEmployeesFiltered({ page, pageSize, employeeName, companyId, shopId, departmentId, subDepartmentId, applicationAccess }) {
        const [results] = await this._query(sqlGetEmployeesFiltered(), [
            page, pageSize, employeeName, companyId, shopId, departmentId, subDepartmentId, applicationAccess,
        ]);
        const rows = extractRows(results);

        if (!rows || rows.length === 0) {
            return { rows: [], totalRecords: 0, limitPage: 1 };
        }

        const totalRecords = rows[0].total_records ?? 0;
        const limitPage = rows[0].total_pages ?? 1;

        // Converte employee_photo pra Base64 (quando presente) e remove os
        // campos de paginação denormalizados em cada linha pela stored procedure.
        const cleanRows = rows.map(({ total_records, total_pages, employee_photo, ...rest }) => ({
            ...rest,
            employee_photo: employee_photo
                ? (Buffer.isBuffer(employee_photo) ? employee_photo.toString('base64') : employee_photo)
                : employee_photo,
        }));

        return { rows: cleanRows, totalRecords, limitPage };
    }

    async findUsersFiltered({ page, pageSize, name, applicationId, status }) {
        const [results] = await this._query(sqlGetUsersFiltered(), [page, pageSize, name, applicationId, status]);
        const rows = extractRows(results);

        if (!rows || rows.length === 0) {
            return { rows: [], totalRecords: 0, limitPage: 1 };
        }

        const totalRecords = rows[0].total_records ?? 0;
        const limitPage = rows[0].total_pages ?? 1;
        const cleanRows = rows.map(({ total_records, total_pages, ...rest }) => rest);

        return { rows: cleanRows, totalRecords, limitPage };
    }

    async findPhotoRecord(employeeId) {
        const [[row]] = await this._query(SQL_GET_USER_FILE_ID, [employeeId]);
        const fileId = row?.file_id;
        if (!fileId) return null;
        return FileService.findById(fileId);
    }

    async attachPhoto(employeeId, file, actingUserId) {
        const saved = await FileService.save(file, EMPLOYEE_MODULE, actingUserId);
        const [result] = await this._query(SQL_UPDATE_USER_FILE_ID, [saved.id, employeeId]);
        return { affectedRows: result.affectedRows };
    }
}

module.exports = { MysqlEmployeeRepository };
