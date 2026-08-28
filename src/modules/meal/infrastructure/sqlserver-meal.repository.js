/**
 * @fileoverview Adapter SQL Server — implementa `MealRepositoryPort`.
 * @module modules/meal/infrastructure/sqlserver-meal.repository
 */

const { poolPromise, sql } = require('../../../config/sqlserver');
const { AppError } = require('../../../errors/app.error');
const { MealRepositoryPort } = require('../application/ports/meal-repository.port');
const {
    sqlGetDinersForCache,
    sqlFindDiner,
    sqlGetDinerGroups,
    sqlFindDinerGroupById,
    sqlInsertDinerGroup,
    sqlPatchDinerGroup,
    sqlInsertMealLog,
    sqlFindMealLogByClientUuid,
    sqlCountMealsByDinerOnDate,
    sqlBranchExists,
    sqlReportDaily,
    sqlReportCostCenter,
    sqlReportPayee,
    sqlReportDuplicates,
    sqlReportTerminatedServed,
    PATCH_DINER_GROUP_FIELDS,
} = require('../repositories/sqlserver/meal.queries');

/**
 * Janela padrão de desligamento no cache do aparelho.
 *
 * 30 dias, o mesmo prazo do expurgo de biometria previsto para a etapa 7
 * (`RA_DEMISSA` + 30). Não é coincidência conveniente: se a pessoa deixa de
 * existir para o reconhecimento facial nesse prazo, não há motivo para
 * continuar aparecendo na tela do operador depois dele.
 *
 * Sem janela, o cache carregaria 6.900 linhas para usar 1.719 — 75% da base é
 * desligado, e quem saiu em 2019 não está na fila do almoço.
 */
const DEFAULT_TERMINATED_WINDOW_DAYS = 30;

/** Violação de unicidade no SQL Server. */
const UNIQUE_VIOLATION_CODES = new Set([2601, 2627]);

class SqlServerMealRepository extends MealRepositoryPort {
    /**
     * Executa o acesso ao banco traduzindo a falha.
     *
     * Mesma política do módulo GIPP: o texto cru do SQL Server nunca sai para
     * quem chamou, porque expõe nome de objeto e estrutura interna do banco.
     *
     * Aqui não há tradutor de `RAISERROR` como no GIPP, e é de propósito: este
     * módulo não chama procedure nenhuma. Toda regra é constraint declarativa
     * (`CK_meal_log_diner`, `CK_meal_log_host`, `UX_meal_log_client`) e as
     * mensagens amigáveis são geradas antes, pelo domínio. Se um erro de
     * constraint chega até aqui, é bug — o domínio deixou passar — e 500 é a
     * resposta honesta.
     *
     * @private
     */
    async _run(fn, fallbackMessage) {
        try {
            return await fn();
        } catch (error) {
            if (error instanceof AppError) throw error;

            /**
             * Loga ANTES de embrulhar, e isto não é redundância.
             *
             * O `error.middleware.js` da casa faz
             * `if (!(err instanceof AppError)) console.error(...)` — ou seja,
             * `AppError` NÃO é logado, por decisão deliberada: erro operacional
             * conhecido não precisa de stack no log.
             *
             * A consequência é que uma falha TÉCNICA de banco embrulhada em
             * AppError 500 sai daqui invisível: a mensagem chega ao operador e o
             * servidor não registra nada. Em 19/08/2026 isso custou várias
             * rodadas de diagnóstico — o cadastro facial falhava, as fotos eram
             * processadas com sucesso, e não havia uma linha de log em lugar
             * nenhum.
             *
             * 500 é falha técnica, não regra de negócio. Merece log.
             */
            console.error(
                `[meal] ${fallbackMessage}`,
                {
                    number: error?.number,
                    code: error?.code,
                    message: error?.message,
                },
            );

            throw new AppError(fallbackMessage, 500, {
                code: error.number ? `SQLSERVER_${error.number}` : 'SQLSERVER_ERROR',
                details: error,
            });
        }
    }

    /** @private */
    _isUniqueViolation(error) {
        if (UNIQUE_VIOLATION_CODES.has(error?.number)) return true;
        // O driver mssql aninha o erro original em `originalError` / `precedingErrors`.
        const nested = [error?.originalError, ...(error?.precedingErrors || [])];
        return nested.some(e => UNIQUE_VIOLATION_CODES.has(e?.number ?? e?.info?.number));
    }

    // ─── Comensais ──────────────────────────────────────────────────────────

    async findDinersForCache({ branchCode = null, terminatedWindowDays } = {}) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('branch_code', sql.VarChar(10), branchCode ?? null)
                .input('terminated_window_days', sql.Int,
                    Number.isInteger(terminatedWindowDays)
                        ? terminatedWindowDays
                        : DEFAULT_TERMINATED_WINDOW_DAYS)
                .query(sqlGetDinersForCache());
            return result.recordset;
        }, 'Não foi possível carregar a lista de comensais.');
    }

    async findDiner({ companyCode, employeeId, branchCode }, serviceDate) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('company_code', sql.VarChar(10), companyCode)
                .input('employee_id', sql.VarChar(6), employeeId)
                .input('branch_code', sql.VarChar(10), branchCode)
                .input('service_date', sql.Date, serviceDate)
                .query(sqlFindDiner());
            return result.recordset[0] ?? null;
        }, 'Não foi possível consultar o colaborador.');
    }

    async countMealsByDinerOnDate({ companyCode, employeeId, branchCode }, serviceDate) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('company_code', sql.VarChar(10), companyCode)
                .input('employee_id', sql.VarChar(6), employeeId)
                .input('branch_code', sql.VarChar(10), branchCode)
                .input('service_date', sql.Date, serviceDate)
                .query(sqlCountMealsByDinerOnDate());
            return Number(result.recordset[0]?.meals_today ?? 0);
        }, 'Não foi possível contar as refeições do dia.');
    }

    async findBranch(branchCode) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('branch_code', sql.VarChar(10), branchCode)
                .query(sqlBranchExists());
            return result.recordset[0] ?? null;
        }, 'Não foi possível consultar a filial.');
    }

    // ─── Baldes ─────────────────────────────────────────────────────────────

    async findDinerGroups({ siteCode = null, onlyActive = true } = {}) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('site_code', sql.VarChar(10), siteCode ?? null)
                .input('only_active', sql.Bit, onlyActive ? 1 : 0)
                .query(sqlGetDinerGroups());
            return result.recordset;
        }, 'Não foi possível carregar os grupos sem matrícula.');
    }

    async findDinerGroupById(id) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('id', sql.Int, id)
                .query(sqlFindDinerGroupById());
            return result.recordset[0] ?? null;
        }, 'Não foi possível consultar o grupo.');
    }

    async insertDinerGroup(payload, actor) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('label', sql.VarChar(60), payload.label)
                .input('payee_id', sql.Int, payload.payee_id ?? null)
                .input('billable', sql.Bit, payload.billable ? 1 : 0)
                .input('requires_host', sql.Bit, payload.requires_host ? 1 : 0)
                .input('site_code', sql.VarChar(10), payload.site_code ?? null)
                .input('sort_order', sql.SmallInt, payload.sort_order ?? 0)
                .input('is_active', sql.Bit, payload.is_active === undefined ? 1 : (payload.is_active ? 1 : 0))
                .input('created_by', sql.Int, actor.userId)
                .input('created_by_branch_code', sql.VarChar(10), actor.branchCode)
                .query(sqlInsertDinerGroup());
            return result.recordset[0];
        }, 'Não foi possível cadastrar o grupo.');
    }

    async patchDinerGroup(id, fields, actor) {
        const keys = Object.keys(fields).filter(k => k in PATCH_DINER_GROUP_FIELDS);
        if (keys.length === 0) return this.findDinerGroupById(id);

        return this._run(async () => {
            const pool = await poolPromise;
            const request = pool.request()
                .input('id', sql.Int, id)
                .input('updated_by', sql.Int, actor.userId)
                .input('updated_by_branch_code', sql.VarChar(10), actor.branchCode);

            for (const key of keys) {
                request.input(key, this._patchType(key), this._patchValue(key, fields[key]));
            }

            const result = await request.query(sqlPatchDinerGroup(keys));
            return result.recordset[0] ?? null;
        }, 'Não foi possível atualizar o grupo.');
    }

    /** @private */
    _patchType(key) {
        switch (PATCH_DINER_GROUP_FIELDS[key]) {
            case 'VarChar':  return key === 'label' ? sql.VarChar(60) : sql.VarChar(10);
            case 'Int':      return sql.Int;
            case 'SmallInt': return sql.SmallInt;
            case 'Bit':      return sql.Bit;
            default:         return sql.VarChar(60);
        }
    }

    /** @private */
    _patchValue(key, value) {
        if (value === undefined) return null;
        if (PATCH_DINER_GROUP_FIELDS[key] === 'Bit') return value ? 1 : 0;
        return value;
    }

    // ─── Registro de refeição ───────────────────────────────────────────────

    /**
     * Grava a refeição, ou devolve a que já existe.
     *
     * Idempotente por `client_uuid`, em dois níveis:
     *   1. `WHERE NOT EXISTS` na própria query — cobre o reenvio normal;
     *   2. captura de violação de unicidade + releitura — cobre a corrida entre
     *      dois envios simultâneos do mesmo uuid, em que o `NOT EXISTS` dos dois
     *      passa antes de qualquer um gravar.
     *
     * Sem o nível 2, um duplo toque no botão "sincronizar" com a rede lenta
     * devolveria 500 para uma refeição que foi registrada com sucesso — e o
     * aparelho tentaria de novo, para sempre.
     */
    async insertMealLog(payload) {
        return this._run(async () => {
            const pool = await poolPromise;

            try {
                const result = await this._mealLogRequest(pool, payload).query(sqlInsertMealLog());
                const inserted = Array.isArray(result.rowsAffected)
                    ? Number(result.rowsAffected[0] ?? 0)
                    : 0;

                return {
                    log: result.recordset[0] ?? null,
                    created: inserted === 1,
                };
            } catch (error) {
                if (!this._isUniqueViolation(error)) throw error;

                // Alguém gravou o mesmo client_uuid entre o NOT EXISTS e o INSERT.
                // A refeição está registrada — devolvê-la é a resposta correta.
                const existing = await this.findMealLogByClientUuid(payload.client_uuid);
                return { log: existing, created: false };
            }
        }, 'Não foi possível registrar a refeição.');
    }

    /** @private */
    _mealLogRequest(pool, p) {
        return pool.request()
            .input('diner_type', sql.TinyInt, p.diner_type)
            .input('company_code', sql.VarChar(10), p.company_code ?? null)
            .input('employee_id', sql.VarChar(6), p.employee_id ?? null)
            .input('branch_code', sql.VarChar(10), p.branch_code ?? null)
            .input('diner_group_id', sql.Int, p.diner_group_id ?? null)
            .input('host_company_code', sql.VarChar(10), p.host_company_code ?? null)
            .input('host_employee_id', sql.VarChar(6), p.host_employee_id ?? null)
            .input('host_branch_code', sql.VarChar(10), p.host_branch_code ?? null)
            .input('guest_label', sql.VarChar(80), p.guest_label ?? null)
            .input('cost_center', sql.VarChar(9), p.cost_center ?? null)
            .input('site_code', sql.VarChar(10), p.site_code)
            .input('served_at', sql.DateTime2(0), p.served_at)
            .input('service_date', sql.Date, p.service_date)
            .input('meal_type', sql.TinyInt, p.meal_type)
            .input('identified_by', sql.TinyInt, p.identified_by)
            .input('match_score', sql.Decimal(5, 4), p.match_score ?? null)
            .input('operator_user_id', sql.Int, p.operator_user_id ?? null)
            .input('client_uuid', sql.UniqueIdentifier, p.client_uuid)
            .input('synced_at', sql.DateTime2(0), p.synced_at ?? null);
    }

    // ─── Relatórios ─────────────────────────────────────────────────────────

    /**
     * Todos os relatórios compartilham a mesma assinatura de filtro, então
     * compartilham a montagem dos parâmetros. Um recorte de data é obrigatório —
     * quem garante isso é o caso de uso, e a razão está lá.
     *
     * @private
     */
    _reportRequest(pool, { dateFrom, dateTo, siteCode }) {
        return pool.request()
            .input('date_from', sql.Date, dateFrom)
            .input('date_to', sql.Date, dateTo)
            .input('site_code', sql.VarChar(10), siteCode ?? null);
    }

    async reportDaily(filters) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await this._reportRequest(pool, filters).query(sqlReportDaily());
            return result.recordset;
        }, 'Não foi possível montar o relatório diário.');
    }

    async reportCostCenter(filters) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await this._reportRequest(pool, filters).query(sqlReportCostCenter());
            return result.recordset;
        }, 'Não foi possível montar o rateio por centro de custo.');
    }

    async reportPayee(filters) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await this._reportRequest(pool, filters).query(sqlReportPayee());
            return result.recordset;
        }, 'Não foi possível montar o relatório por contratante.');
    }

    async reportDuplicates(filters) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await this._reportRequest(pool, filters).query(sqlReportDuplicates());
            return result.recordset;
        }, 'Não foi possível apurar as refeições repetidas.');
    }

    async reportTerminatedServed(filters) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await this._reportRequest(pool, filters)
                .query(sqlReportTerminatedServed());
            return result.recordset;
        }, 'Não foi possível apurar as refeições de desligados.');
    }

    async findMealLogByClientUuid(clientUuid) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('client_uuid', sql.UniqueIdentifier, clientUuid)
                .query(sqlFindMealLogByClientUuid());
            return result.recordset[0] ?? null;
        }, 'Não foi possível consultar o registro da refeição.');
    }
}

module.exports = {
    SqlServerMealRepository,
    DEFAULT_TERMINATED_WINDOW_DAYS,
};
