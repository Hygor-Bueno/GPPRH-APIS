/**
 * @fileoverview Serviço principal do módulo GIPP.
 *
 * Gerencia o ciclo completo de jornadas de trabalho:
 *   1. Consulta de marcações de ponto (time records)
 *   2. Processamento de jornadas (SQL Server + replicação no MySQL GIPP)
 *   3. Fechamento de jornadas com inserção de recibos de pagamento
 *
 * O fechamento calcula automaticamente as durações individuais de cada tipo
 * de lançamento (horas normais, extras e noturnas) e grava a descrição completa
 * no campo `description` do recibo, incluindo prefixo de data e duração.
 *
 * @module modules/gipp/services/gipp.service
 */

const { randomUUID }    = require('crypto');
const { poolPromise, sql } = require('../../../config/sqlserver');
const { poolGippMySQL } = require('../../../config/mysql');
const { AppError }      = require('../../../errors/app.error');
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
    sqlGetTimeRecordsForValidation
} = require('../repositories/sqlserver/gipp.repository');

/**
 * Mapeamento de tipos de marcação de ponto.
 * @readonly
 * @enum {number}
 */
const RECORD_TYPE = {
    /** Entrada no trabalho. */
    ENTRY:       1,
    /** Início de intervalo. */
    BREAK_START: 2,
    /** Fim de intervalo. */
    BREAK_END:   3,
    /** Saída do trabalho. */
    EXIT:        4
};

/**
 * `payment_type_id` fixo utilizado no fechamento de jornada GIPP.
 * Corresponde ao tipo "Fechamento de Jornada" na tabela `gipp_payment_types`.
 * @constant {number}
 */
const PAYMENT_TYPE_CLOSING = 6;

/**
 * Serviço principal do módulo GIPP.
 *
 * Centraliza as operações de leitura de status, marcações de ponto, processamento
 * e fechamento de jornadas de trabalho.
 */
class GippService {

    // ─── Consultas de Suporte ─────────────────────────────────────────────────

    /**
     * Retorna todos os status de jornada disponíveis (`cf_work_schedule_status`).
     *
     * @returns {Promise<Object[]>} Lista de status.
     * @throws {AppError} Em caso de falha na consulta.
     */
    async getStatus() {
        try {
            const pool   = await poolPromise;
            const result = await pool.request().query(sqlGetStatus());
            return result.recordset;
        } catch (error) {
            throw new AppError(error.message || 'Error fetching status', 500, error.code || 'SQLSERVER_ERROR', error);
        }
    }

    /**
     * Retorna os tipos de pagamento registrados no sistema GIPP.
     *
     * @returns {Promise<Object[]>} Lista de pagamentos registrados.
     * @throws {AppError} Em caso de falha na consulta.
     */
    async getPaymentRegistered() {
        try {
            const pool   = await poolPromise;
            const result = await pool.request().query(sqlGetPaymentRegistered());
            return result.recordset;
        } catch (error) {
            throw new AppError(error.message || 'Error fetching payment registered', 500, error.code || 'SQLSERVER_ERROR', error);
        }
    }

    /**
     * Retorna todos os tipos de marcação de ponto (`cf_record_types`).
     *
     * @returns {Promise<Object[]>} Lista de tipos de registro (entrada, saída, intervalo, etc.).
     * @throws {AppError} Em caso de falha na consulta.
     */
    async getRecordTypes() {
        try {
            const pool   = await poolPromise;
            const result = await pool.request().query(sqlGetRecordTypes());
            return result.recordset;
        } catch (error) {
            throw new AppError(error.message || 'Error fetching record types', 500, error.code || 'SQLSERVER_ERROR', error);
        }
    }

    // ─── Marcações de Ponto ───────────────────────────────────────────────────

    /**
     * Retorna todos os registros de ponto de uma jornada específica.
     *
     * @param {string} codWorkSchedule - Código único da jornada de trabalho.
     * @returns {Promise<Object[]>} Lista de marcações de ponto da jornada.
     * @throws {AppError} Em caso de falha na consulta.
     */
    async getTimeRecordsByCodWork(codWorkSchedule) {
        try {
            const pool   = await poolPromise;
            const result = await pool.request()
                .input('codWorkSchedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlGetTimeRecordsByCodWork());
            return result.recordset;
        } catch (error) {
            throw new AppError(error.message || 'Error fetching time records', 500, error.code || 'SQLSERVER_ERROR', error);
        }
    }

    /**
     * Retorna marcações de ponto com suporte a paginação e filtros dinâmicos.
     *
     * @param {Object}  [filters={}]                  - Parâmetros de busca.
     * @param {string}  [filters.codWorkSchedule]     - Código da jornada.
     * @param {number}  [filters.statusCod]           - ID do status da jornada.
     * @param {number}  [filters.pageNumber=1]        - Página (base 1).
     * @param {number}  [filters.pageSize=50]         - Registros por página.
     * @param {string}  [filters.name]                - Filtro parcial pelo nome do colaborador.
     * @param {string}  [filters.branch]              - Código da filial.
     * @param {string}  [filters.costCenter]          - Código do centro de custo.
     * @returns {Promise<Object[]>} Lista paginada de marcações de ponto.
     * @throws {AppError} Em caso de falha na consulta.
     */
    async getTimeRecords(filters = {}) {
        try {
            const pool   = await poolPromise;
            const result = await pool.request()
                .input('cod_work_schedule', sql.VarChar(50),   filters.codWorkSchedule || null)
                .input('id_status_fk',      sql.Int,           filters.statusCod  ? Number(filters.statusCod)  : null)
                .input('page_number',        sql.Int,           filters.pageNumber  ? Number(filters.pageNumber)  : 1)
                .input('page_size',          sql.Int,           filters.pageSize    ? Number(filters.pageSize)    : 50)
                .input('name',               sql.NVarChar(200), filters.name        || null)
                .input('branch',             sql.NVarChar(10),  filters.branch      || null)
                .input('cost_center',        sql.NVarChar(20),  filters.costCenter  || null)
                .query(sqlGetTimeRecords());
            return result.recordset;
        } catch (error) {
            throw new AppError(error.message || 'Error fetching time records', 500, error.code || 'SQLSERVER_ERROR', error);
        }
    }

    /**
     * Insere uma nova marcação de ponto para um colaborador.
     *
     * @param {Object}       payload                      - Dados da marcação.
     * @param {string}       payload.employee_id          - Matrícula do colaborador.
     * @param {number}       payload.id_record_type_fk    - Tipo de marcação (1=entrada, 2=início intervalo, etc.).
     * @param {string|null}  payload.times                - Horário da marcação (ISO 8601, sem fuso; o serviço adiciona `'Z'`).
     * @param {string}       payload.branch_time_record   - Código da filial.
     * @param {number}       userId                       - ID do usuário autenticado no sistema global.
     * @returns {Promise<Object[]>} Resultado da inserção.
     * @throws {AppError} Em caso de falha na inserção.
     */
    async insertTimeRecord(payload, userId) {
        try {
            const pool   = await poolPromise;
            const result = await pool.request()
                .input('employee_id',        sql.VarChar(20),  payload.employee_id)
                .input('id_global',          sql.Int,          userId)
                .input('id_record_type_fk',  sql.Int,          payload.id_record_type_fk)
                .input('times',              sql.DateTime,     payload.times ? new Date(payload.times + 'Z') : null)
                .input('branch_time_record', sql.VarChar(10),  payload.branch_time_record)
                .query(sqlInsertTimeRecord());
            return result.recordset;
        } catch (error) {
            throw new AppError(error.message || 'Error inserting time record', 500, error.code || 'SQLSERVER_ERROR', error);
        }
    }

    /**
     * Atualiza o horário de uma marcação de ponto existente.
     *
     * @param {Object}       payload                  - Dados da atualização.
     * @param {number}       payload.id_time_records  - ID da marcação a ser atualizada.
     * @param {string|null}  payload.times            - Novo horário (ISO 8601 sem fuso; o serviço adiciona `'Z'`).
     * @param {number}       userId                   - ID do usuário autenticado no sistema global.
     * @returns {Promise<Object[]>} Resultado da atualização.
     * @throws {AppError} Em caso de falha na atualização.
     */
    async updateTimeRecord(payload, userId) {
        try {
            const pool   = await poolPromise;
            const result = await pool.request()
                .input('id_time_records', sql.Int,      payload.id_time_records)
                .input('id_global',       sql.Int,      userId)
                .input('times',           sql.DateTime, payload.times ? new Date(payload.times + 'Z') : null)
                .query(sqlUpdateTimeRecord());
            return result.recordset;
        } catch (error) {
            throw new AppError(error.message || 'Error updating time record', 500, error.code || 'SQLSERVER_ERROR', error);
        }
    }

    // ─── Cancelamento e Processamento ─────────────────────────────────────────

    /**
     * Cancela uma jornada de trabalho, alterando seu status para "Cancelado".
     *
     * @param {string} codWorkSchedule - Código da jornada a cancelar.
     * @returns {Promise<void>}
     * @throws {AppError} Em caso de falha na operação.
     */
    async cancelWorkSchedule(codWorkSchedule) {
        try {
            const pool = await poolPromise;
            await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlCancelWorkSchedule());
        } catch (error) {
            throw new AppError(error.message || 'Error cancelling work schedule', 500, error.code || 'SQLSERVER_ERROR', error);
        }
    }

    /**
     * Processa uma ou mais jornadas de trabalho em sequência completa:
     *   1. Executa `sqlProcessWorkSchedules` no SQL Server (calcula pagamentos e atualiza status).
     *   2. Busca os dados de pagamento calculados para replicação.
     *   3. Replica cada pagamento no banco MySQL GIPP via stored procedure.
     *   4. Fecha as jornadas inserindo os recibos em `gipp_payment_receipt`.
     *
     * @param {string|string[]} codWorkSchedules - Código(s) de jornada (array ou string separada por vírgulas).
     * @param {string}          userId           - Matrícula do usuário que está processando.
     * @param {string}          userBranchCode   - Código da filial do usuário.
     * @returns {Promise<{payments: Object[], closing: Object[]}>} Pagamentos processados e resultado do fechamento.
     * @throws {AppError} 404 se nenhum dado de pagamento for encontrado após o processamento.
     * @throws {AppError} 500 para erros de SQL Server ou MySQL.
     */
    async processWorkSchedules(codWorkSchedules, userId, userBranchCode) {
        // Aceita array ou string separada por vírgula
        const scheduleList   = Array.isArray(codWorkSchedules) ? codWorkSchedules : codWorkSchedules.split(',');
        const scheduleString = scheduleList.join(',');

        try {
            const pool = await poolPromise;

            // 1. Processa as jornadas no SQL Server (calcula cf_payments, atualiza status)
            await pool.request()
                .input('CodWorkSchedules', sql.VarChar(sql.MAX), scheduleString)
                .query(sqlProcessWorkSchedules());

            // 2. Busca os dados de pagamento para replicação no MySQL GIPP
            const payments = await this._getPaymentsForReplication(scheduleList);

            if (!payments.length) {
                throw new AppError('No payment data found after processing work schedules', 404);
            }

            // 3. Replica cada pagamento no MySQL GIPP via stored procedure
            for (const payment of payments) {
                await this._replicatePaymentToMySQL(payment);
            }

            // 4. Fecha e persiste os recibos em gipp_payment_receipt
            const closing = await this.closeWorkSchedules(scheduleList, userId, userBranchCode);

            return { payments, closing };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Error processing work schedules', 500, error.code || 'SQLSERVER_ERROR', error);
        }
    }

    /**
     * Busca os dados de pagamento calculados para um conjunto de jornadas,
     * preparados para replicação no MySQL GIPP.
     *
     * @private
     * @param {string[]} scheduleList - Lista de códigos de jornada.
     * @returns {Promise<Object[]>} Lista de objetos de pagamento com campos CPF, data, descrições e valores.
     * @throws {AppError} Em caso de falha na consulta.
     */
    async _getPaymentsForReplication(scheduleList) {
        try {
            const pool = await poolPromise;
            const { sql: query, params } = sqlGetPayments(scheduleList);
            const request = pool.request();
            for (const [key, value] of Object.entries(params)) {
                request.input(key, sql.VarChar(50), value);
            }
            const result = await request.query(query);
            return result.recordset || [];
        } catch (error) {
            throw new AppError(error.message || 'Error fetching payments for replication', 500, error.code || 'SQLSERVER_ERROR', error);
        }
    }

    /**
     * Replica um registro de pagamento no banco MySQL GIPP via stored procedure
     * `sp_insert_recibo_pagamento_por_cpf`.
     *
     * @private
     * @param {Object} payment               - Dados de pagamento vindos do SQL Server.
     * @param {string} payment.cpf           - CPF do colaborador.
     * @param {string} payment.data          - Data de referência.
     * @param {string} payment.descricao     - Descrição do lançamento principal.
     * @param {string} payment.referencia    - Referência (horas/dias) do lançamento principal.
     * @param {number} payment.proventos     - Valor do lançamento principal.
     * @param {string} payment.descricao2    - Descrição do 2º lançamento (horas extras).
     * @param {string} payment.referencia2   - Referência do 2º lançamento.
     * @param {number} payment.proventos2    - Valor do 2º lançamento.
     * @param {string} payment.descricao3    - Descrição do 3º lançamento (hora extra noturna).
     * @param {string} payment.referencia3   - Referência do 3º lançamento.
     * @param {number} payment.proventos3    - Valor do 3º lançamento.
     * @param {number} payment.total_proventos - Soma total dos proventos.
     * @returns {Promise<void>}
     * @throws {AppError} Em caso de falha no MySQL GIPP.
     */
    async _replicatePaymentToMySQL(payment) {
        let conn;
        try {
            conn = await poolGippMySQL.getConnection();
            await conn.execute(
                `CALL sp_insert_recibo_pagamento_por_cpf(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    payment.cpf,
                    payment.data,
                    payment.descricao,
                    payment.referencia,
                    payment.proventos,
                    payment.descricao2,
                    payment.referencia2,
                    payment.proventos2,
                    payment.descricao3,
                    payment.referencia3,
                    payment.proventos3,
                    payment.total_proventos
                ]
            );
        } catch (error) {
            throw new AppError(error.message || 'Error replicating payment to MySQL', 500, 'MYSQL_GIPP_ERROR', error);
        } finally {
            if (conn) conn.release();
        }
    }

    // ─── Fechamento de Jornada ────────────────────────────────────────────────

    /**
     * Valida os registros de ponto de uma jornada e retorna os dados estruturados.
     *
     * Regras de validação:
     * - Deve existir pelo menos um registro de entrada (tipo 1).
     * - Os intervalos devem ser completos: cada início (tipo 2) precisa de um fim (tipo 3).
     * - A saída (tipo 4) é opcional — jornadas parciais são aceitas.
     *
     * @param {Object[]} records         - Lista de marcações de ponto da jornada.
     * @param {string}   codWorkSchedule - Código da jornada (usado nas mensagens de erro).
     * @returns {{ entry: Object, exit: Object|null, hasExit: boolean }} Marcações estruturadas.
     * @throws {AppError} 422 se faltar entrada ou se os pares de intervalo estiverem incompletos.
     */
    _validateTimeRecords(records, codWorkSchedule) {
        const entry  = records.find(r => r.id_record_type_fk === RECORD_TYPE.ENTRY);
        const exit   = records.find(r => r.id_record_type_fk === RECORD_TYPE.EXIT);
        const breaks = records.filter(r =>
            r.id_record_type_fk === RECORD_TYPE.BREAK_START ||
            r.id_record_type_fk === RECORD_TYPE.BREAK_END
        );

        if (!entry) {
            throw new AppError(
                `Jornada ${codWorkSchedule}: sem registro de entrada (tipo 1).`, 422
            );
        }

        // Verifica pares de intervalo: cada início (tipo 2) deve ter um fim (tipo 3)
        const breakStarts = breaks.filter(r => r.id_record_type_fk === RECORD_TYPE.BREAK_START);
        const breakEnds   = breaks.filter(r => r.id_record_type_fk === RECORD_TYPE.BREAK_END);

        if (breakStarts.length !== breakEnds.length) {
            throw new AppError(
                `Jornada ${codWorkSchedule}: pares de intervalo inválidos ` +
                `(${breakStarts.length} início(s) x ${breakEnds.length} fim(s)).`, 422
            );
        }

        if (!exit) {
            // Saída ausente é permitida (jornada parcial)
            return { entry, exit: null, hasExit: false };
        }

        return { entry, exit, hasExit: true };
    }

    /**
     * Fecha uma ou mais jornadas, inserindo os itens de recibo em `gipp_payment_receipt`.
     *
     * Para cada jornada o fluxo é:
     *   1. Verifica se já existe recibo (evita duplicatas via `event_code`).
     *   2. Busca dados da jornada (colaborador, empresa, filial).
     *   3. Valida os registros de ponto.
     *   4. Determina a referência `YYYYMM` e a data do trabalho.
     *   5. Busca os valores calculados em `cf_payments`.
     *   6. Calcula as durações individuais de cada tipo via `sqlGetWorkDurations`.
     *   7. Monta os itens de recibo com descrição e duração embutidas.
     *   8. Insere cada item no banco com o mesmo `receipt_group_id` (UUID por jornada).
     *
     * Itens com `amount = 0` são filtrados automaticamente — apenas lançamentos
     * com valor positivo são persistidos.
     *
     * Pode ser chamado isoladamente ou como etapa final de `processWorkSchedules`.
     *
     * @param {string|string[]} codWorkSchedules - Código(s) de jornada.
     * @param {string}          userId           - Matrícula do usuário responsável pelo fechamento.
     * @param {string}          userBranchCode   - Código da filial do usuário.
     * @returns {Promise<Array<{
     *   cod_work_schedule: string,
     *   status: 'inserted'|'skipped',
     *   items?: number,
     *   details?: {description: string, amount: number}[],
     *   reason?: string
     * }>>} Resultado por jornada: `inserted` com quantidade/detalhes, ou `skipped` com motivo.
     * @throws {AppError} 404 se a jornada não for encontrada.
     * @throws {AppError} 422 se a referência não puder ser determinada, os registros de ponto
     *   forem inválidos ou os valores de pagamento não estiverem disponíveis.
     */
    async closeWorkSchedules(codWorkSchedules, userId, userBranchCode) {
        const scheduleList = Array.isArray(codWorkSchedules)
            ? codWorkSchedules
            : codWorkSchedules.split(',').map(s => s.trim());

        const pool    = await poolPromise;
        const results = [];

        for (const codWorkSchedule of scheduleList) {

            // 1 — Verifica duplicata pelo event_code que embute o cod_work_schedule
            const dupCheck = await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlCheckExistingReceipt());

            if (dupCheck.recordset[0]?.total > 0) {
                results.push({
                    cod_work_schedule: codWorkSchedule,
                    status: 'skipped',
                    reason: 'Recibo já gerado para esta jornada.'
                });
                continue;
            }

            // 2 — Dados da jornada + colaborador + empresa
            const wsResult = await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlGetWorkScheduleData());

            const ws = wsResult.recordset[0];
            if (!ws) {
                throw new AppError(`Jornada ${codWorkSchedule} não encontrada.`, 404);
            }

            // 3 — Valida registros de ponto (entrada obrigatória, pares de intervalo)
            const trResult = await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlGetTimeRecordsForValidation());

            this._validateTimeRecords(trResult.recordset, codWorkSchedule);

            // 4 — Referência YYYYMM (derivada do primeiro registro de entrada)
            const refResult = await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlGetWorkScheduleReference());

            const reference = refResult.recordset[0]?.reference;
            const workDate  = refResult.recordset[0]?.work_date;
            if (!reference) {
                throw new AppError(
                    `Jornada ${codWorkSchedule}: não foi possível determinar a referência (YYYYMM).`, 422
                );
            }

            // 5 — Valores de pagamento calculados por sqlProcessWorkSchedules
            const payResult = await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlGetPaymentDataByCodWork());

            const pay = payResult.recordset[0];
            if (!pay) {
                throw new AppError(
                    `Jornada ${codWorkSchedule}: valores de pagamento não encontrados. ` +
                    `Execute o processamento antes do fechamento.`, 422
                );
            }

            // 6 — UUID único por jornada: todos os itens da mesma jornada compartilham o mesmo receipt_group_id
            const receiptGroupId = randomUUID();
            // Converte workDate de DD/MM/YYYY para Date (SQL Server DATE)
            let referenceDateObj = null;
            if (workDate) {
                const [day, month, year] = workDate.split('/');
                referenceDateObj = new Date(`${year}-${month}-${day}`);
            }

            const basePayload = {
                company_code:           ws.company_code           != null ? String(ws.company_code)                        : null,
                branch_code:            ws.branch_time_record     != null ? String(ws.branch_time_record).padStart(4, '0') : null,
                employee_code:          ws.employee_id            != null ? String(ws.employee_id).padStart(6, '0')        : null,
                employee_name:          ws.employee_name          != null ? String(ws.employee_name)                       : null,
                branch_name:            ws.branch_name            != null ? String(ws.branch_name)                         : null,
                work_schedule_id:       codWorkSchedule,
                reference,
                reference_date:         referenceDateObj,
                movement_type:          'E',
                is_active:              1,
                receipt_group_id:       receiptGroupId,
                payment_type_id:        PAYMENT_TYPE_CLOSING,
                created_by:             userId         != null ? String(userId)         : null,
                created_by_branch_code: userBranchCode != null ? String(userBranchCode) : null,
                payee_id:               null
            };

            // 6b — Durações individuais calculadas diretamente de cf_time_records
            const durResult = await pool.request()
                .input('cod_work_schedule', sql.VarChar(50), codWorkSchedule)
                .query(sqlGetWorkDurations());

            const dur = durResult.recordset[0];

            /**
             * Formata minutos em string legível para descrição do recibo.
             * - `null` / `<= 0` → `null` (item omitido da descrição)
             * - `< 60`          → `"Xm"` (ex.: `"45 min"`)
             * - múltiplo de 60  → `"Xh"` (ex.: `"8 h"`)
             * - demais          → `"XhYm"` (ex.: `"5h40m"`)
             *
             * @param {number|null} min - Duração em minutos.
             * @returns {string|null} String formatada ou `null`.
             */
            const _fmt = (min) => {
                if (!min || min <= 0) return null;
                if (min < 60)        return `${min} min`;
                if (min % 60 === 0)  return `${Math.floor(min / 60)} h`;
                return `${Math.floor(min / 60)}h${min % 60}m`;
            };

            // FullExpedient indica jornada completa → exibe "1d" ao invés da duração em horas
            const refNormal = dur?.FullExpedient ? '1d' : _fmt(dur?.WorkMinutes);
            const refExtra  = _fmt(dur?.WorkExtraMinutes);
            const refNight  = _fmt(dur?.NightMinutes);

            const datePrefix = workDate ? `${workDate} - ` : '';

            /**
             * Monta os itens de recibo correspondendo a cada tipo de lançamento:
             * - N   → Serviços Prestados (horas normais)
             * - HE  → Hora(s) Extra(s)
             * - EXN → Hora(s) Extra(s) Noturna(s)
             *
             * O `event_code` embute o `codWorkSchedule` para garantir unicidade por jornada
             * e permitir a verificação de duplicatas na etapa 1.
             * Itens com `amount = 0` são removidos pelo `.filter`.
             */
            const items = [
                {
                    ...basePayload,
                    description: `${datePrefix}Serviços Prestados${refNormal ? ` - ${refNormal}` : ''}`,
                    amount:      pay.normal_payment,
                    event_code:  `N|${codWorkSchedule}`
                },
                {
                    ...basePayload,
                    description: `${datePrefix}Hora(s) Extra(s)${refExtra ? ` - ${refExtra}` : ''}`,
                    amount:      pay.extra_hour_payment,
                    event_code:  `HE|${codWorkSchedule}`
                },
                {
                    ...basePayload,
                    description: `${datePrefix}Hora(s) Extra(s) Noturna(s)${refNight ? ` - ${refNight}` : ''}`,
                    amount:      pay.night_bonus_payment,
                    event_code:  `EXN|${codWorkSchedule}`
                }
            ].filter(item => item.amount > 0);

            if (!items.length) {
                results.push({
                    cod_work_schedule: codWorkSchedule,
                    status: 'skipped',
                    reason: 'Todos os valores de pagamento são zero.'
                });
                continue;
            }

            // 7 — Insere cada item; todos compartilham o mesmo receipt_group_id desta jornada
            for (const item of items) {
                await pool.request()
                    .input('company_code',           sql.VarChar(10),      item.company_code           ?? null)
                    .input('branch_code',             sql.VarChar(10),      item.branch_code             ?? null)
                    .input('employee_code',           sql.VarChar(20),      item.employee_code           ?? null)
                    .input('payee_id',                sql.Int,              item.payee_id               ?? null)
                    .input('employee_name',           sql.VarChar(200),     item.employee_name           ?? null)
                    .input('branch_name',             sql.VarChar(200),     item.branch_name             ?? null)
                    .input('work_schedule_id',        sql.VarChar(20),      item.work_schedule_id        ?? null)
                    .input('reference',               sql.VarChar(6),       item.reference               ?? null)
                    .input('reference_date',          sql.Date,             item.reference_date          ?? null)
                    .input('description',             sql.VarChar(500),     item.description             ?? null)
                    .input('amount',                  sql.Decimal(18, 2),   item.amount)
                    .input('movement_type',           sql.Char(1),          item.movement_type           ?? null)
                    .input('is_active',               sql.Bit,              item.is_active               ?? 1)
                    .input('receipt_group_id',        sql.UniqueIdentifier, item.receipt_group_id)
                    .input('event_code',              sql.VarChar(100),     item.event_code              ?? null)
                    .input('payment_type_id',         sql.Int,              item.payment_type_id         ?? null)
                    .input('created_by',              sql.VarChar(50),      item.created_by              ?? null)
                    .input('created_by_branch_code',  sql.VarChar(10),      item.created_by_branch_code  ?? null)
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
            }

            results.push({
                cod_work_schedule: codWorkSchedule,
                status:  'inserted',
                items:   items.length,
                details: items.map(i => ({ description: i.description, amount: i.amount }))
            });
        }

        return results;
    }
}

module.exports = { GippService };
