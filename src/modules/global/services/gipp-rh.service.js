const { poolPromise, sql } = require('../../../config/sqlserver');
const { AppError } = require('../../../errors/app.error');

const { sqlGetBeneficiariesByEmployee,sqlGetReceiptsBatch, sqlEmployeesCompensations, sqlActiveBeneficiaries, sqlInsertCompensation, sqlUpdateCompensation, sqlGetEmployeesPaginated, sqlGetReceipt } = require('../repositories/sqlserver/gipp-rh.repository');

class GippRhService {
    constructor(id = 0) {
        this.id = id;
    }
    async getActiveCompensations() {
        try {
            const pool = await poolPromise;
            const result = await pool.request().query(sqlEmployeesCompensations());
            return result.recordset;
        } catch (error) {
            throw new AppError(
                error.message || 'Erro ao buscar compensações',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    async postCompensations(payload) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('name', sql.VarChar, payload.name)
                .input('description', sql.VarChar, payload.description)
                .input('active', sql.Bit, payload.active === 'true' || payload.active === true)
                .input('created_by', sql.VarChar, payload.created_by)
                .input('created_by_branch', sql.VarChar, payload.created_by_branch)
                .query(sqlInsertCompensation());
            return result.recordset[0];
        } catch (error) {
            throw new AppError(
                error.message || 'Error inserting compensation',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    async postBeneficiary(payload) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('employee_id', sql.VarChar, payload.employee_id)
                .input('compensation_id', sql.Int, payload.compensation_id)
                .input('value', sql.Decimal(18, 2), payload.value)
                .input('branch_code', sql.VarChar, payload.branch_code)
                .input('start_date', sql.Date, payload.start_date)
                .input('created_by', sql.VarChar, payload.created_by)
                .input('updated_by', sql.VarChar, payload.updated_by)
                .execute('sp_gipp_insert_employee_compensation');
            return result.recordset?.[0] || {};
        } catch (error) {
            throw new AppError(
                error.message || 'Error inserting beneficiary',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    async putBeneficiary(payload) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('id', sql.Int, payload.id)
                .input('employee_id', sql.VarChar, payload.employee_id)
                .input('compensation_id', sql.Int, payload.compensation_id)
                .input('value', sql.Decimal(18, 2), payload.value)
                .input('branch_code', sql.VarChar, payload.branch_code)
                .input('start_date', sql.Date, payload.start_date)
                .input('created_by', sql.VarChar, payload.created_by)
                .input('updated_by', sql.VarChar, payload.updated_by)
                // 🔥 chamando a procedure
                .execute('sp_gipp_insert_employee_compensation');
            return result.recordset?.[0] || {};
        } catch (error) {
            throw new AppError(
                error.message || 'Error inserting beneficiary',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    async getEmployeesPaginated(filters) {
        try {
            const pool = await poolPromise;
const result = await pool.request()
                .input('PageNumber', sql.Int, filters.page || 1)
                .input('PageSize', sql.Int, filters.pageSize || 50)
                .input('EmployeeName', sql.NVarChar, filters.name || null)
                .input('CostCenterCode', sql.NVarChar, filters.costCenter || null)
                .input('BranchCode', sql.NVarChar, filters.branch || null)
                .input('CompanyCNPJ', sql.NVarChar, filters.cnpj || null)
                .input('Status', sql.Char, filters.status || null)
                .query(sqlGetEmployeesPaginated());

            return result.recordset;
        } catch (error) {
            throw new AppError(
                error.message || 'Erro ao buscar colaboradores paginados',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    async putCompensations(payload) {
        try {
            const pool = await poolPromise;
            const result = await pool.request().query(sqlUpdateCompensation(payload));
            return result.recordset[0];
        } catch (error) {
            throw new AppError(
                error.message || 'Error updating compensation',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    async getActiveBeneficiaries() {
        try {
            const pool = await poolPromise;
            const result = await pool.request().query(sqlActiveBeneficiaries());
            return result.recordset;
        } catch (error) {
            throw new AppError(
                error.message || 'Error when entering compensation',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    async getReceiptData(employeeCode, branchCode, referenceInit, referenceEnd) {
        try {
            const pool = await poolPromise;
            const result = await pool
                .request()
                .query(sqlGetBeneficiariesByEmployee(
                    employeeCode,
                    branchCode,
                    referenceInit,
                    referenceEnd
                ));

            if (!result.recordset?.length) return [];

            const key = Object.keys(result.recordset[0])[0];
            return JSON.parse(result.recordset[0][key] || '[]');
        } catch (error) {
            throw new AppError(
                error.message || 'Error when fetching receipt data',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    async getReceiptBatch(recipients) {
        try {
            // recipients: Array<{ employee_code, branch_code, references: string[] }>
            if (!recipients?.length) return [];

            const pool = await poolPromise;
            const result = await pool
                .request()
                .query(sqlGetReceiptsBatch(recipients));

            if (!result.recordset?.length) return [];

            const key = Object.keys(result.recordset[0])[0];
            return JSON.parse(result.recordset[0][key] || '[]');
        } catch (error) {
            throw new AppError(
                error.message || 'Error when fetching receipt batch',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }
    async getReceipt(employeeCode, branchCode, referenceInit, referenceEnd) {
        try {
            const pool = await poolPromise;
            const result = await pool.request().query(sqlGetReceipt(employeeCode, branchCode, referenceInit, referenceEnd));
            return result.recordset;
        } catch (error) {
            throw new AppError(
                error.message || 'Error when entering compensation',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }
}

module.exports = { GippRhService };