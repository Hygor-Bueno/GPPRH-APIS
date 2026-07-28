/**
 * @fileoverview Adapter SQL Server — implementa `PayeeRepositoryPort`.
 * @module modules/global/infrastructure/payee/sqlserver-payee.repository
 */

const { poolPromise, sql } = require('../../../../config/sqlserver');
const { AppError } = require('../../../../errors/app.error');
const { PayeeRepositoryPort } = require('../../application/payee/ports/payee-repository.port');
const {
    sqlGetPayees,
    sqlInsertPayee,
    sqlUpdatePayee,
    sqlPatchPayee,
    sqlDeletePayee,
    PATCH_PAYEE_FIELDS,
} = require('../../repositories/sqlserver/payee.repository');

class SqlServerPayeeRepository extends PayeeRepositoryPort {
    /** @private */
    async _wrap(fn, fallbackMessage) {
        try {
            return await fn();
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || fallbackMessage, 500, error.code || 'SQLSERVER_ERROR', error);
        }
    }

    async findAll(filters) {
        return this._wrap(async () => {
            const pool = await poolPromise;
            const { sql: query, params } = sqlGetPayees(filters);
            const request = pool.request();
            for (const [key, value] of Object.entries(params)) {
                request.input(key, value);
            }
            const result = await request.query(query);
            return result.recordset;
        }, 'Error fetching payees');
    }

    async insert(payload) {
        return this._wrap(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('type', sql.VarChar(20), payload.type)
                .input('name', sql.VarChar(200), payload.name)
                .input('document', sql.VarChar(20), payload.document ?? null)
                .input('email', sql.VarChar(100), payload.email ?? null)
                .input('phone', sql.VarChar(20), payload.phone ?? null)
                .input('is_active', sql.Bit, payload.is_active)
                .input('created_by', sql.VarChar(50), payload.created_by)
                .input('created_by_branch_code', sql.VarChar(10), payload.created_by_branch_code)
                .query(sqlInsertPayee());
            return result.recordset[0];
        }, 'Error inserting payee');
    }

    async update(payload) {
        return this._wrap(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('id', sql.Int, payload.id)
                .input('type', sql.VarChar(20), payload.type)
                .input('name', sql.VarChar(200), payload.name)
                .input('document', sql.VarChar(20), payload.document ?? null)
                .input('email', sql.VarChar(100), payload.email ?? null)
                .input('phone', sql.VarChar(20), payload.phone ?? null)
                .input('is_active', sql.Bit, payload.is_active)
                .input('updated_by', sql.VarChar(50), payload.updated_by)
                .input('updated_by_branch_code', sql.VarChar(10), payload.updated_by_branch_code)
                .query(sqlUpdatePayee());
            return result.recordset?.[0] ?? null;
        }, 'Error updating payee');
    }

    async patch(id, fields, updatedBy, updatedByBranchCode) {
        return this._wrap(async () => {
            const fieldNames = Object.keys(fields);
            const pool = await poolPromise;
            const request = pool.request();

            request.input('id', sql.Int, id);
            request.input('updated_by', sql.VarChar(50), updatedBy);
            request.input('updated_by_branch_code', sql.VarChar(10), updatedByBranchCode);

            for (const field of fieldNames) {
                const sqlType = PATCH_PAYEE_FIELDS[field];
                if (sqlType === 'Bit') request.input(field, sql.Bit, fields[field]);
                else request.input(field, sql.VarChar, fields[field]);
            }

            const result = await request.query(sqlPatchPayee(fieldNames));
            return result.recordset?.[0] ?? null;
        }, 'Error patching payee');
    }

    async exists(id) {
        return this._wrap(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('id', sql.Int, id)
                .query('SELECT id FROM GIPP.dbo.gipp_payee WHERE id = @id');
            return !!result.recordset?.[0];
        }, 'Error checking payee');
    }

    async hasActiveReceipts(id) {
        return this._wrap(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('id', sql.Int, id)
                .query('SELECT TOP 1 id FROM GIPP.dbo.gipp_payment_receipt WHERE payee_id = @id AND is_active = 1');
            return !!result.recordset?.[0];
        }, 'Error checking linked payment receipts');
    }

    async remove(id) {
        return this._wrap(async () => {
            const pool = await poolPromise;
            await pool.request().input('id', sql.Int, id).query(sqlDeletePayee());
        }, 'Error deleting payee');
    }
}

module.exports = { SqlServerPayeeRepository };
