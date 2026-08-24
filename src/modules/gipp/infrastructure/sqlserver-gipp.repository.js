/**
 * @fileoverview Adapter SQL Server — implementa `GippRepositoryPort`.
 * @module modules/gipp/infrastructure/sqlserver-gipp.repository
 */

const { poolPromise, sql } = require('../../../config/sqlserver');
const { AppError } = require('../../../errors/app.error');
const { GippRepositoryPort } = require('../application/ports/gipp-repository.port');
const { WORK_SCHEDULE_STATUS, DISCARDABLE_STATUSES } = require('../domain/work-schedule-status');
const { CHANGE_REASON } = require('../domain/work-schedule-change-reason');
const {
    CHANGE_SOURCE,
    bindContext,
    withAuditContext,
} = require('../../../infra/sqlserver/session-context');
const { translateSqlServerError } = require('./sqlserver-error.translator');
const {
    sqlGetStatus,
    sqlGetPaymentRegistered,
    sqlGetPaymentByStatus,
    sqlGetPaymentByLauncher,
    sqlGetRecordTypes,
    sqlGetTimeRecords,
    sqlGetTimeRecordsByCodWork,
    sqlInsertTimeRecord,
    sqlUpdateTimeRecord,
    sqlCancelWorkSchedule,
    sqlGetWorkSchedulesStatus,
    sqlApproveWorkSchedules,
    sqlProcessWorkSchedules,
    sqlGetPayments,
    sqlGetWorkScheduleData,
    sqlGetPaymentDataByCodWork,
    sqlGetWorkScheduleReference,
    sqlGetWorkDurations,
    sqlCheckExistingReceipt,
    sqlGetTimeRecordsForValidation,
} = require('../repositories/sqlserver/gipp.queries');

class SqlServerGippRepository extends GippRepositoryPort {
    /**
     * Executa o acesso ao banco traduzindo a falha.
     *
     * Erros de regra de negócio lançados pelas procedures com `RAISERROR` viram
     * 4xx em português (ver `sqlserver-error.translator`). O que não for
     * reconhecido é falha técnica e continua 500 — mas com a mensagem genérica
     * do módulo, não com o texto cru do SQL Server, que expõe nome de objeto e
     * estrutura interna do banco a quem chamou.
     *
     * @private
     */
    async _run(fn, fallbackMessage) {
        try {
            return await fn();
        } catch (error) {
            if (error instanceof AppError) throw error;

            const known = translateSqlServerError(error);
            if (known) {
                throw new AppError(known.message, known.status, { code: known.code, details: error });
            }

            // O terceiro parâmetro de AppError é um OBJETO { code, details }.
            // Até 08/2026 passava-se uma string aqui e o erro original como
            // quarto argumento — com isso `options.code` ficava undefined, o
            // code caía para 'GENERIC_ERROR' e os detalhes eram descartados.
            throw new AppError(fallbackMessage, 500, {
                code: error.code || 'SQLSERVER_ERROR',
                details: error,
            });
        }
    }

    /**
     * Contagem de linhas da operação de negócio dentro de um batch com contexto
     * de auditoria.
     *
     * Não dá para usar `rowsAffected[0]`: o batch começa com seis
     * `EXEC sys.sp_set_session_context`, então o índice 0 passa a ser o do
     * primeiro deles, não o do UPDATE. Por isso `withAuditContext` acrescenta um
     * `SELECT @@ROWCOUNT AS affected_rows` logo depois da operação, e é ele que
     * lemos aqui.
     *
     * @param {import('mssql').IResult<any>} result
     * @returns {number}
     * @private
     */
    _affectedRows(result) {
        return result.recordset?.[0]?.affected_rows ?? 0;
    }

    // ─── Status e Tipos ─────────────────────────────────────────────────────

    async findStatus() {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request().query(sqlGetStatus());
            return result.recordset;
        }, 'Não foi possível consultar os status de jornada.');
    }

    async findPaymentRegistered(filters = {}) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('branch', sql.VarChar(10), filters.branch || null)
                .input('cost_center', sql.VarChar(20), filters.costCenter || null)
                .query(sqlGetPaymentRegistered());
            return result.recordset;
        }, 'Não foi possível consultar as jornadas em aberto.');
    }

    async findPaymentByStatus(status, filters = {}, options = {}) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('status', sql.Int, status)
                .input('branch', sql.VarChar(10), filters.branch || null)
                .input('cost_center', sql.VarChar(20), filters.costCenter || null)
                .query(sqlGetPaymentByStatus(options.withValues === true));
            return result.recordset;
        }, 'Não foi possível consultar a fila de jornadas.');
    }

    async findPaymentByLauncher(launchedBy, filters = {}) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('launched_by', sql.Int, launchedBy)
                .input('branch', sql.VarChar(10), filters.branch || null)
                .input('cost_center', sql.VarChar(20), filters.costCenter || null)
                .query(sqlGetPaymentByLauncher());
            return result.recordset;
        }, 'Não foi possível consultar as jornadas lançadas por este usuário.');
    }

    async findRecordTypes() {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request().query(sqlGetRecordTypes());
            return result.recordset;
        }, 'Não foi possível consultar os tipos de marcação.');
    }

    // ─── Registros de Ponto ─────────────────────────────────────────────────

    async findTimeRecordsByCodWork(codWorkSchedule) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('codWorkSchedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlGetTimeRecordsByCodWork());
            return result.recordset;
        }, 'Não foi possível consultar as marcações de ponto.');
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
        }, 'Não foi possível consultar as marcações de ponto.');
    }

    /**
     * Registra a marcação.
     *
     * `id_global` e os dois snapshots descrevem a MESMA pessoa: o usuário
     * autenticado que lançou a marcação. Não é o colaborador da jornada — esse é
     * `cf_work_schedules.employee_id` + `branch_time_record`, informados no
     * payload. Confundir os dois foi o risco levantado na revisão de 08/2026, e
     * a coerência é verificável: as 66.457 linhas com snapshot preenchido têm 28
     * matrículas distintas (os lançadores), não 1.247 (os colaboradores).
     *
     * A marcação de entrada (tipo 1) cria a jornada e a de saída (tipo 4) move
     * 1 → 2, ambas dentro da procedure — por isso a chamada vai envolvida no
     * contexto de auditoria: os dois eventos de `cf_work_schedule_status_history`
     * nascem daqui.
     *
     * @param {object} payload
     * @param {import('../../../utils/audit-actor').AuditActor} actor
     */
    async insertTimeRecord(payload, actor) {
        return this._run(async () => {
            const pool = await poolPromise;
            const request = pool.request()
                .input('employee_id', sql.VarChar(20), payload.employee_id)
                .input('id_global', sql.Int, actor?.globalUserId ?? null)
                .input('id_record_type_fk', sql.Int, payload.id_record_type_fk)
                .input('times', sql.DateTime, payload.times ? new Date(payload.times + 'Z') : null)
                .input('branch_time_record', sql.VarChar(10), payload.branch_time_record)
                .input('registration_snapshot', sql.VarChar(6), actor?.registration ?? null)
                .input('branch_code_snapshot', sql.VarChar(4), actor?.branchCode ?? null);

            bindContext(request, actor, {
                source: CHANGE_SOURCE.BACKEND,
                reason: Number(payload.id_record_type_fk) === 4
                    ? CHANGE_REASON.SENT_TO_APPROVAL
                    : CHANGE_REASON.CREATED,
            });

            const result = await request.query(withAuditContext(sqlInsertTimeRecord()));
            return result.recordset;
        }, 'Não foi possível registrar a marcação de ponto.');
    }

    /**
     * Atualiza a marcação.
     *
     * A procedure sobrescreve `id_global` com quem editou, então os snapshots
     * vão junto e passam a descrever o editor — mantendo as três colunas
     * coerentes entre si. Não altera `cf_work_schedules`, portanto não gera
     * evento de histórico; o contexto não é necessário aqui.
     *
     * @param {object} payload
     * @param {import('../../../utils/audit-actor').AuditActor} actor
     */
    async updateTimeRecord(payload, actor) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('id_time_records', sql.Int, payload.id_time_records)
                .input('id_global', sql.Int, actor?.globalUserId ?? null)
                .input('times', sql.DateTime, payload.times ? new Date(payload.times + 'Z') : null)
                .input('registration_snapshot', sql.VarChar(6), actor?.registration ?? null)
                .input('branch_code_snapshot', sql.VarChar(4), actor?.branchCode ?? null)
                .query(sqlUpdateTimeRecord());
            return result.recordset;
        }, 'Não foi possível atualizar a marcação de ponto.');
    }

    // ─── Jornadas de Trabalho ───────────────────────────────────────────────

    async cancelWorkSchedule(codWorkSchedule, allowedStatuses = DISCARDABLE_STATUSES, actor = null) {
        return this._run(async () => {
            const pool = await poolPromise;
            const { sql: query, params } = sqlCancelWorkSchedule(allowedStatuses);
            const request = pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .input('st_cancelled', sql.Int, WORK_SCHEDULE_STATUS.CANCELLED);
            for (const [key, value] of Object.entries(params)) {
                request.input(key, sql.Int, value);
            }

            bindContext(request, actor, {
                source: CHANGE_SOURCE.BACKEND,
                reason: CHANGE_REASON.CANCELLED,
            });

            const result = await request.query(
                withAuditContext(query, { captureRowCount: true })
            );
            return this._affectedRows(result);
        }, 'Não foi possível desconsiderar a jornada.');
    }

    async findWorkSchedulesStatus(scheduleList) {
        return this._run(async () => {
            const pool = await poolPromise;
            const { sql: query, params } = sqlGetWorkSchedulesStatus(scheduleList);
            const request = pool.request();
            for (const [key, value] of Object.entries(params)) {
                request.input(key, sql.VarChar(50), value);
            }
            const result = await request.query(query);
            return result.recordset || [];
        }, 'Não foi possível consultar o status das jornadas.');
    }

    /**
     * UPDATE em lote — uma única instrução para N jornadas.
     *
     * O trigger é `FROM inserted` / `LEFT JOIN deleted`, ou seja, baseado em
     * conjunto: um UPDATE que muda 30 linhas gera 30 eventos de histórico, todos
     * com o mesmo responsável e o mesmo motivo. Não há laço por jornada aqui, e
     * não deve haver — seria N conexões e N contextos.
     *
     * @param {string[]} scheduleList
     * @param {number} fromStatus
     * @param {number} toStatus
     * @param {{ actor?: object|null, source?: string, reason?: string|null }} [audit]
     */
    async approveWorkSchedules(scheduleList, fromStatus, toStatus, audit = {}) {
        return this._run(async () => {
            const pool = await poolPromise;
            const { sql: query, params } = sqlApproveWorkSchedules(scheduleList);
            const request = pool.request()
                .input('from_status', sql.Int, fromStatus)
                .input('to_status', sql.Int, toStatus);
            for (const [key, value] of Object.entries(params)) {
                request.input(key, sql.VarChar(50), value);
            }

            bindContext(request, audit.actor ?? null, {
                source: audit.source ?? CHANGE_SOURCE.BACKEND,
                reason: audit.reason ?? null,
            });

            const result = await request.query(
                withAuditContext(query, { captureRowCount: true })
            );
            return this._affectedRows(result);
        }, 'Não foi possível aprovar as jornadas.');
    }

    async revertToPayrollQueue(codWorkSchedule, actor = null) {
        // Mesma query da aprovação, com a transição invertida: 6 → 3.
        // A procedure agora marca 6 (Pagando), não 4 — reverter de 4 não casaria
        // com nada e a jornada ficaria órfã sem ninguém perceber.
        //
        // Origem FINANCIAL_JOB e não BACKEND: a reversão não é uma ação que
        // alguém pediu, é a compensação automática de um fechamento que falhou.
        // Quem auditar precisa distinguir as duas coisas.
        return this.approveWorkSchedules(
            [codWorkSchedule],
            WORK_SCHEDULE_STATUS.PAYING,
            WORK_SCHEDULE_STATUS.AWAITING_PAYROLL,
            {
                actor,
                source: CHANGE_SOURCE.FINANCIAL_JOB,
                reason: CHANGE_REASON.REVERTED_TO_PAYROLL,
            },
        );
    }

    async confirmTreasuryPayment(scheduleList, actor = null) {
        // Transição da tesouraria: 6 → 4, fechando o ciclo.
        return this.approveWorkSchedules(
            scheduleList,
            WORK_SCHEDULE_STATUS.PAYING,
            WORK_SCHEDULE_STATUS.FINISHED,
            {
                actor,
                source: CHANGE_SOURCE.BACKEND,
                reason: CHANGE_REASON.PAYMENT_FINISHED,
            },
        );
    }

    /**
     * Processa as jornadas (3 → 6) via procedure.
     *
     * `pcr_process_work_schedules` abre transação própria e dá ROLLBACK no
     * CATCH dela, por isso o contexto vai por batch e NÃO por `sql.Transaction`:
     * o rollback interno zeraria o `@@TRANCOUNT` e o COMMIT do Node estouraria
     * erro 3902 em cima do erro real. Ver `infra/sqlserver/session-context`.
     *
     * @param {string} scheduleCsv
     * @param {import('../../../utils/audit-actor').AuditActor|null} [actor]
     */
    async processWorkSchedules(scheduleCsv, actor = null) {
        return this._run(async () => {
            const pool = await poolPromise;
            const request = pool.request()
                .input('CodWorkSchedules', sql.VarChar(sql.MAX), scheduleCsv);

            // BACKEND, e não CALCULATION_JOB: quem dispara é o RH em
            // `POST /gipp/payments`, com usuário autenticado. `CALCULATION_JOB`
            // fica reservado para quando o cálculo virar rotina sem usuário —
            // marcar uma ação humana como job apagaria essa distinção.
            bindContext(request, actor, {
                source: CHANGE_SOURCE.BACKEND,
                reason: CHANGE_REASON.CALCULATION_STARTED,
            });

            await request.query(withAuditContext(sqlProcessWorkSchedules()));
        }, 'Não foi possível processar as jornadas.');
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
        }, 'Não foi possível obter os valores calculados das jornadas.');
    }

    // ─── Fechamento de Jornada ──────────────────────────────────────────────

    async hasExistingReceipt(codWorkSchedule) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlCheckExistingReceipt());
            return (result.recordset[0]?.total ?? 0) > 0;
        }, 'Não foi possível verificar se a jornada já possui recibo.');
    }

    async findWorkScheduleData(codWorkSchedule) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlGetWorkScheduleData());
            return result.recordset[0] ?? null;
        }, 'Não foi possível obter os dados da jornada.');
    }

    async findTimeRecordsForValidation(codWorkSchedule) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlGetTimeRecordsForValidation());
            return result.recordset;
        }, 'Não foi possível validar as marcações da jornada.');
    }

    async findWorkScheduleReference(codWorkSchedule) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlGetWorkScheduleReference());
            return result.recordset[0] ?? {};
        }, 'Não foi possível determinar a referência da jornada.');
    }

    async findPaymentDataByCodWork(codWorkSchedule) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlGetPaymentDataByCodWork());
            return result.recordset[0] ?? null;
        }, 'Não foi possível obter os valores de pagamento da jornada.');
    }

    async findWorkDurations(codWorkSchedule) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlGetWorkDurations());
            return result.recordset[0] ?? null;
        }, 'Não foi possível calcular as durações da jornada.');
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
        }, 'Não foi possível inserir o item do recibo.');
    }
}

module.exports = { SqlServerGippRepository };
