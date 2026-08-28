/**
 * @fileoverview Adapter SQL Server — implementa `GippRhRepositoryPort`.
 * @module modules/global/infrastructure/gipp-rh/sqlserver-gipp-rh.repository
 */

const { poolPromise, sql } = require('../../../../config/sqlserver');
const { AppError } = require('../../../../errors/app.error');
const { GippRhRepositoryPort } = require('../../application/gipp-rh/ports/gipp-rh-repository.port');
const { CHANGE_REASON } = require('../../../gipp/domain/work-schedule-change-reason');
const {
    CHANGE_SOURCE,
    bindContext,
    withAuditContext,
} = require('../../../../infra/sqlserver/session-context');
const {
    sqlActiveBeneficiaries,
    sqlEmployeesCompensations,
    sqlUpdateCompensation,
    sqlInsertCompensation,
    sqlGetEmployeesPaginated,
    sqlGetBeneficiariesByEmployee,
    sqlGetEventCodes,
    sqlInsertPaymentReceipt,
    sqlGetPaymentReceipts,
    sqlUpdatePaymentReceipt,
    sqlPatchPaymentReceipt,
    PATCH_RECEIPT_FIELDS,
    sqlGetReceipt,
    sqlGetPaymentTypes,
    sqlGetReceiptsByGroupIds,
    sqlGetWorkSchedulesByReceiptGroupIds,
} = require('../../repositories/sqlserver/gipp-rh.queries');

class SqlServerGippRhRepository extends GippRhRepositoryPort {
    /** @private */
    async _run(fn, fallbackMessage) {
        try {
            return await fn();
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || fallbackMessage, 500, error.code || 'SQLSERVER_ERROR', error);
        }
    }

    // ─── Compensações ───────────────────────────────────────────────────────

    async findActiveCompensations() {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request().query(sqlEmployeesCompensations());
            return result.recordset;
        }, 'Erro ao buscar compensações');
    }

    async insertCompensation(payload) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('name', sql.VarChar, payload.name)
                .input('description', sql.VarChar, payload.description)
                .input('active', sql.Bit, payload.active === 'true' || payload.active === true)
                .input('created_by', sql.VarChar, payload.created_by)
                .input('created_by_branch', sql.VarChar, payload.created_by_branch)
                .query(sqlInsertCompensation());
            return result.recordset[0];
        }, 'Error inserting compensation');
    }

    async updateCompensation(payload) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('id', sql.Int, payload.id)
                .input('name', sql.VarChar, payload.name)
                .input('description', sql.VarChar, payload.description)
                .input('active', sql.Bit, payload.active)
                .input('user_code', sql.VarChar, payload.user_code)
                .input('user_branch', sql.VarChar, payload.branch_code)
                .execute(sqlUpdateCompensation());
            return result.recordset[0];
        }, 'Error updating compensation');
    }

    // ─── Beneficiários ──────────────────────────────────────────────────────

    async findActiveBeneficiaries() {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request().query(sqlActiveBeneficiaries());
            return result.recordset;
        }, 'Error when entering compensation');
    }

    async upsertBeneficiary(payload) {
        return this._run(async () => {
            const pool = await poolPromise;
            const request = pool.request();
            if (payload.id !== undefined) {
                request.input('id', sql.Int, payload.id);
            }
            request
                .input('employee_id', sql.VarChar, payload.employee_id)
                .input('compensation_id', sql.Int, payload.compensation_id)
                .input('value', sql.Decimal(18, 2), payload.value)
                .input('branch_code', sql.VarChar, payload.branch_code)
                .input('start_date', sql.Date, payload.start_date)
                .input('created_by', sql.VarChar, payload.created_by)
                .input('updated_by', sql.VarChar, payload.updated_by);
            const result = await request.execute('sp_gipp_insert_employee_compensation');
            return result.recordset?.[0] || {};
        }, 'Error inserting beneficiary');
    }

    // ─── Colaboradores ──────────────────────────────────────────────────────

    async findEmployeesPaginated(filters) {
        return this._run(async () => {
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
        }, 'Erro ao buscar colaboradores paginados');
    }

    // ─── Recibos — PDF ──────────────────────────────────────────────────────

    async findReceiptData(employeeCode, branchCode, referenceInit, referenceEnd, payeeId) {
        return this._run(async () => {
            const pool = await poolPromise;
            const { sql: query, params } = sqlGetBeneficiariesByEmployee(
                employeeCode, branchCode, referenceInit, referenceEnd, payeeId
            );
            const request = pool.request();
            for (const [key, value] of Object.entries(params)) {
                request.input(key, value);
            }
            const result = await request.query(query);

            if (!result.recordset?.length) return [];

            const key = Object.keys(result.recordset[0])[0];
            return JSON.parse(result.recordset[0][key] || '[]');
        }, 'Error when fetching receipt data');
    }

    async findReceiptsByGroupIds(groupIds) {
        return this._run(async () => {
            const pool = await poolPromise;
            const { sql: query, params } = sqlGetReceiptsByGroupIds(groupIds);
            const request = pool.request();
            for (const [key, value] of Object.entries(params)) {
                request.input(key, value);
            }
            const result = await request.query(query);

            if (!result.recordset?.length) return [];

            const key = Object.keys(result.recordset[0])[0];
            return JSON.parse(result.recordset[0][key] || '[]');
        }, 'Error when fetching receipts by group ids');
    }

    async findWorkSchedulesByReceiptGroupIds(groupIds) {
        return this._run(async () => {
            const pool = await poolPromise;
            const { sql: query, params } = sqlGetWorkSchedulesByReceiptGroupIds(groupIds);
            const request = pool.request();
            for (const [key, value] of Object.entries(params)) {
                request.input(key, value);
            }
            const result = await request.query(query);
            return result.recordset || [];
        }, 'Não foi possível consultar as jornadas dos recibos informados.');
    }

    // ─── Códigos de evento / Tipos de pagamento ─────────────────────────────

    async findEventCodes() {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request().query(sqlGetEventCodes());
            return result.recordset;
        }, 'Error fetching event codes');
    }

    async findPaymentTypes() {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request().query(sqlGetPaymentTypes());
            return result.recordset;
        }, 'Error fetching payment types');
    }

    // ─── Recibos de pagamento — CRUD ────────────────────────────────────────

    async insertPaymentReceipt(payload) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('company_code', sql.VarChar(10), payload.company_code)
                .input('branch_code', sql.VarChar(10), payload.branch_code)
                .input('employee_code', sql.VarChar(20), payload.employee_code ?? null)
                .input('payee_id', sql.Int, payload.payee_id ?? null)
                .input('employee_name', sql.VarChar(200), payload.employee_name?.toUpperCase())
                .input('branch_name', sql.VarChar(200), payload.branch_name?.toUpperCase())
                .input('work_schedule_id', sql.VarChar(50), payload.work_schedule_id ?? null)
                .input('reference', sql.VarChar(6), payload.reference)
                .input('reference_date', sql.Date, payload.reference_date ? new Date(payload.reference_date) : null)
                .input('description', sql.VarChar(500), payload.description)
                .input('amount', sql.Decimal(18, 2), payload.amount)
                .input('movement_type', sql.Char(1), payload.movement_type)
                .input('is_active', sql.Bit, payload.is_active)
                .input('receipt_group_id', sql.VarChar(50), payload.receipt_group_id ?? null)
                .input('event_code', sql.VarChar(50), payload.event_code ?? null)
                .input('payment_type_id', sql.Int, payload.payment_type_id ?? null)
                .input('created_by', sql.VarChar(50), payload.created_by)
                .input('created_by_branch_code', sql.VarChar(10), payload.created_by_branch_code)
                .query(sqlInsertPaymentReceipt());
            return result.recordset[0];
        } catch (error) {
            // Violação de índice único — combinação employee/branch/reference/group/event já existe
            if (error.number === 2601 || error.number === 2627) {
                throw new AppError(
                    'Já existe um lançamento com este event_code neste grupo de recibo. Use outro event_code ou receipt_group_id.',
                    409
                );
            }
            throw new AppError(error.message || 'Não foi possível inserir o recibo de pagamento.', 500, error.code || 'SQLSERVER_ERROR', error);
        }
    }

    async findPaymentReceipts(filters) {
        return this._run(async () => {
            const pool = await poolPromise;
            const { sql: query, params } = sqlGetPaymentReceipts(filters);
            const request = pool.request();
            for (const [key, value] of Object.entries(params)) {
                request.input(key, value);
            }
            const result = await request.query(query);
            return result.recordset;
        }, 'Error fetching payment receipts');
    }

    async updatePaymentReceipt(payload) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('id', sql.Int, payload.id)
                .input('description', sql.VarChar(500), payload.description)
                .input('amount', sql.Decimal(18, 2), payload.amount)
                .input('movement_type', sql.Char(1), payload.movement_type)
                .input('is_active', sql.Bit, payload.is_active)
                .input('reference_date', sql.Date, payload.reference_date ? new Date(payload.reference_date) : null)
                .input('event_code', sql.VarChar(50), payload.event_code ?? null)
                .input('work_schedule_id', sql.VarChar(50), payload.work_schedule_id ?? null)
                .input('payment_type_id', sql.Int, payload.payment_type_id ?? null)
                .input('updated_by', sql.VarChar(50), payload.updated_by)
                .input('updated_by_branch_code', sql.VarChar(10), payload.updated_by_branch_code)
                .query(sqlUpdatePaymentReceipt());
            return result.recordset?.[0] ?? null;
        }, 'Error updating payment receipt');
    }

    async patchPaymentReceipt(id, fields, updatedBy, updatedByBranchCode) {
        return this._run(async () => {
            const fieldNames = Object.keys(fields);
            const pool = await poolPromise;
            const request = pool.request();

            request.input('id', sql.Int, id);
            request.input('updated_by', sql.VarChar(50), updatedBy);
            request.input('updated_by_branch_code', sql.VarChar(10), updatedByBranchCode);

            for (const field of fieldNames) {
                const sqlType = PATCH_RECEIPT_FIELDS[field];
                if (sqlType === 'Decimal') request.input(field, sql.Decimal(18, 2), fields[field]);
                else if (sqlType === 'Int') request.input(field, sql.Int, fields[field]);
                else if (sqlType === 'Bit') request.input(field, sql.Bit, fields[field]);
                else if (sqlType === 'Char') request.input(field, sql.Char(1), fields[field]);
                else if (sqlType === 'Date') request.input(field, sql.Date, fields[field] ? new Date(fields[field]) : null);
                else request.input(field, sql.VarChar, fields[field]);
            }

            const result = await request.query(sqlPatchPaymentReceipt(fieldNames));
            return result.recordset?.[0] ?? null;
        }, 'Error patching payment receipt');
    }

    // ─── Recibos — listagem consolidada ─────────────────────────────────────

    async findReceipt(employeeCode, branchCode, referenceInit, referenceEnd, paymentTypeId, dateFrom, dateTo, workScheduleStatus) {
        return this._run(async () => {
            const pool = await poolPromise;
            const { sql: query, params } = sqlGetReceipt(
                employeeCode, branchCode, referenceInit, referenceEnd, paymentTypeId, dateFrom, dateTo, workScheduleStatus
            );
            const request = pool.request();
            for (const [key, value] of Object.entries(params)) {
                request.input(key, value);
            }
            const result = await request.query(query);
            return result.recordset;
        }, 'Não foi possível consultar os recibos.');
    }

    /**
     * Fecha as jornadas da tesouraria: 6 (Pagando) → 4 (Finalizado).
     *
     * A guarda `AND id_status_fk = 6` é a trava real: jornada que não está em 6
     * não é tocada, ainda que o código chegue na lista.
     *
     * @param {string[]} scheduleList
     * @returns {Promise<number>} Linhas afetadas.
     */
    async confirmTreasuryPayment(scheduleList, actor = null) {
        return this._run(async () => {
            const pool = await poolPromise;
            const placeholders = scheduleList.map((_, i) => `@ws${i}`);
            const request = pool.request()
                .input('from_status', sql.Int, 6)
                .input('to_status', sql.Int, 4);
            scheduleList.forEach((code, i) => request.input(`ws${i}`, sql.VarChar(50), code));

            // Sem o contexto, o trigger de histórico registra esta transição —
            // a que encerra o pagamento — como 'DIRECT_DATABASE' e sem autor.
            bindContext(request, actor, {
                source: CHANGE_SOURCE.BACKEND,
                reason: CHANGE_REASON.PAYMENT_FINISHED,
            });

            const result = await request.query(withAuditContext(`
                UPDATE GIPP.dbo.cf_work_schedules
                SET id_status_fk = @to_status
                WHERE cod_work_schedule IN (${placeholders.join(', ')})
                  AND id_status_fk = @from_status;
            `, { captureRowCount: true }));

            // `rowsAffected[0]` passaria a ser o do primeiro
            // `sp_set_session_context` do batch, não o do UPDATE.
            return result.recordset?.[0]?.affected_rows ?? 0;
        }, 'Não foi possível confirmar o pagamento das jornadas.');
    }

    /**
     * Estado atual das jornadas informadas — usado para separar o que a
     * tesouraria pode fechar do que precisa ser reportado como ignorado.
     *
     * @param {string[]} scheduleList
     * @returns {Promise<Array<{cod_work_schedule: string, id_status_fk: number}>>}
     */
    async findWorkSchedulesStatus(scheduleList) {
        return this._run(async () => {
            const pool = await poolPromise;
            const placeholders = scheduleList.map((_, i) => `@ws${i}`);
            const request = pool.request();
            scheduleList.forEach((code, i) => request.input(`ws${i}`, sql.VarChar(50), code));

            const result = await request.query(`
                SELECT cod_work_schedule, id_status_fk
                FROM GIPP.dbo.cf_work_schedules
                WHERE cod_work_schedule IN (${placeholders.join(', ')});
            `);
            return result.recordset || [];
        }, 'Não foi possível consultar o status das jornadas.');
    }
}

module.exports = { SqlServerGippRhRepository };
