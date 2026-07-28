/**
 * @fileoverview Adapter SQL Server — implementa `GippRepositoryPort`.
 * @module modules/gipp/infrastructure/sqlserver-gipp.repository
 */

const { poolPromise, sql } = require('../../../config/sqlserver');
const { AppError } = require('../../../errors/app.error');
const { GippRepositoryPort } = require('../application/ports/gipp-repository.port');
const {
    sqlGetStatus,
    sqlGetPaymentRegistered,
    sqlGetRecordTypes,
    sqlGetTimeRecords,
    sqlGetTimeRecordsByCodWork,
    sqlInsertTimeRecord,
    sqlUpdateTimeRecord,
    sqlCancelWorkSchedule,
    sqlProcessWorkSchedules,
    sqlGetPayments,
    sqlGetWorkScheduleData,
    sqlGetPaymentDataByCodWork,
    sqlGetWorkScheduleReference,
    sqlGetWorkDurations,
    sqlCheckExistingReceipt,
    sqlGetTimeRecordsForValidation,
} = require('../repositories/sqlserver/gipp.repository');

class SqlServerGippRepository extends GippRepositoryPort {
    /** @private */
    async _run(fn, fallbackMessage) {
        try {
            return await fn();
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || fallbackMessage, 500, error.code || 'SQLSERVER_ERROR', error);
        }
    }

    // ─── Status e Tipos ─────────────────────────────────────────────────────

    async findStatus() {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request().query(sqlGetStatus());
            return result.recordset;
        }, 'Error fetching status');
    }

    async findPaymentRegistered() {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request().query(sqlGetPaymentRegistered());
            return result.recordset;
        }, 'Error fetching payment registered');
    }

    async findRecordTypes() {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request().query(sqlGetRecordTypes());
            return result.recordset;
        }, 'Error fetching record types');
    }

    // ─── Registros de Ponto ─────────────────────────────────────────────────

    async findTimeRecordsByCodWork(codWorkSchedule) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('codWorkSchedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlGetTimeRecordsByCodWork());
            return result.recordset;
        }, 'Error fetching time records');
    }

    async findTimeRecords(filters) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), filters.codWorkSchedule || null)
                .input('id_status_fk', sql.Int, filters.statusCod ? Number(filters.statusCod) : null)
                .input('page_number', sql.Int, filters.pageNumber ? Number(filters.pageNumber) : 1)
                .input('page_size', sql.Int, filters.pageSize ? Number(filters.pageSize) : 50)
                .input('name', sql.NVarChar(200), filters.name || null)
                .input('branch', sql.NVarChar(10), filters.branch || null)
                .input('cost_center', sql.NVarChar(20), filters.costCenter || null)
                .query(sqlGetTimeRecords());
            return result.recordset;
        }, 'Error fetching time records');
    }

    async insertTimeRecord(payload, userId) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('employee_id', sql.VarChar(20), payload.employee_id)
                .input('id_global', sql.Int, userId)
                .input('id_record_type_fk', sql.Int, payload.id_record_type_fk)
                .input('times', sql.DateTime, payload.times ? new Date(payload.times + 'Z') : null)
                .input('branch_time_record', sql.VarChar(10), payload.branch_time_record)
                .query(sqlInsertTimeRecord());
            return result.recordset;
        }, 'Error inserting time record');
    }

    async updateTimeRecord(payload, userId) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('id_time_records', sql.Int, payload.id_time_records)
                .input('id_global', sql.Int, userId)
                .input('times', sql.DateTime, payload.times ? new Date(payload.times + 'Z') : null)
                .query(sqlUpdateTimeRecord());
            return result.recordset;
        }, 'Error updating time record');
    }

    // ─── Jornadas de Trabalho ───────────────────────────────────────────────

    async cancelWorkSchedule(codWorkSchedule) {
        return this._run(async () => {
            const pool = await poolPromise;
            await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlCancelWorkSchedule());
        }, 'Error cancelling work schedule');
    }

    async processWorkSchedules(scheduleCsv) {
        return this._run(async () => {
            const pool = await poolPromise;
            await pool.request()
                .input('CodWorkSchedules', sql.VarChar(sql.MAX), scheduleCsv)
                .query(sqlProcessWorkSchedules());
        }, 'Error processing work schedules');
    }

    async findPaymentsForReplication(scheduleList) {
        return this._run(async () => {
            const pool = await poolPromise;
            const { sql: query, params } = sqlGetPayments(scheduleList);
            const request = pool.request();
            for (const [key, value] of Object.entries(params)) {
                request.input(key, sql.VarChar(50), value);
            }
            const result = await request.query(query);
            return result.recordset || [];
        }, 'Error fetching payments for replication');
    }

    // ─── Fechamento de Jornada ──────────────────────────────────────────────

    async hasExistingReceipt(codWorkSchedule) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlCheckExistingReceipt());
            return (result.recordset[0]?.total ?? 0) > 0;
        }, 'Error checking existing receipt');
    }

    async findWorkScheduleData(codWorkSchedule) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlGetWorkScheduleData());
            return result.recordset[0] ?? null;
        }, 'Error fetching work schedule data');
    }

    async findTimeRecordsForValidation(codWorkSchedule) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlGetTimeRecordsForValidation());
            return result.recordset;
        }, 'Error fetching time records for validation');
    }

    async findWorkScheduleReference(codWorkSchedule) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlGetWorkScheduleReference());
            return result.recordset[0] ?? {};
        }, 'Error fetching work schedule reference');
    }

    async findPaymentDataByCodWork(codWorkSchedule) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlGetPaymentDataByCodWork());
            return result.recordset[0] ?? null;
        }, 'Error fetching payment data');
    }

    async findWorkDurations(codWorkSchedule) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlGetWorkDurations());
            return result.recordset[0] ?? null;
        }, 'Error fetching work durations');
    }

    async insertReceiptItem(item) {
        return this._run(async () => {
            const pool = await poolPromise;
            await pool.request()
                .input('company_code', sql.VarChar(10), item.company_code ?? null)
                .input('branch_code', sql.VarChar(10), item.branch_code ?? null)
                .input('employee_code', sql.VarChar(20), item.employee_code ?? null)
                .input('payee_id', sql.Int, item.payee_id ?? null)
                .input('employee_name', sql.VarChar(200), item.employee_name ?? null)
                .input('branch_name', sql.VarChar(200), item.branch_name ?? null)
                .input('work_schedule_id', sql.VarChar(20), item.work_schedule_id ?? null)
                .input('reference', sql.VarChar(6), item.reference ?? null)
                .input('reference_date', sql.Date, item.reference_date ?? null)
                .input('description', sql.VarChar(500), item.description ?? null)
                .input('amount', sql.Decimal(18, 2), item.amount)
                .input('movement_type', sql.Char(1), item.movement_type ?? null)
                .input('is_active', sql.Bit, item.is_active ?? 1)
                .input('receipt_group_id', sql.UniqueIdentifier, item.receipt_group_id)
                .input('event_code', sql.VarChar(100), item.event_code ?? null)
                .input('payment_type_id', sql.Int, item.payment_type_id ?? null)
                .input('created_by', sql.VarChar(50), item.created_by ?? null)
                .input('created_by_branch_code', sql.VarChar(10), item.created_by_branch_code ?? null)
                .query(`
                    INSERT INTO GIPP.dbo.gipp_payment_receipt (
                        company_code, branch_code, employee_code, payee_id,
                        employee_name, branch_name, work_schedule_id,
                        reference, reference_date, description, amount, movement_type, is_active,
                        receipt_group_id, event_code, payment_type_id,
                        created_at, created_by, created_by_branch_code
                    ) VALUES (
                        @company_code, @branch_code, @employee_code, @payee_id,
                        @employee_name, @branch_name, @work_schedule_id,
                        @reference, ISNULL(@reference_date, GETDATE()), @description, @amount, @movement_type, @is_active,
                        @receipt_group_id, @event_code, @payment_type_id,
                        GETDATE(), @created_by, @created_by_branch_code
                    );
                `);
        }, 'Error inserting receipt item');
    }
}

module.exports = { SqlServerGippRepository };
