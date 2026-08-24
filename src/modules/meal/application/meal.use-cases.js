/**
 * @fileoverview Casos de uso — controle de refeitório.
 *
 * Regra que atravessa o módulo inteiro: **nada aqui bloqueia uma refeição**.
 * Desligado sinaliza, duplicata sinaliza, e as duas são servidas. Negar comida a
 * quem já está na fila é socialmente pesado, e o objetivo do módulo é medição e
 * rateio, não policiamento. O único caso em que o registro é recusado é dado
 * impossível — chave incompleta, grupo inexistente, tipo fora do domínio — e aí
 * a recusa é do banco, não da política.
 *
 * @module modules/meal/application/meal.use-cases
 */

const { AppError } = require('../../../errors/app.error');
const { BadRequestError } = require('../../../errors/bad-request.error');
const { DINER_TYPE, IDENTIFIED_BY } = require('../domain/meal.enums');
const {
    validateMealLog,
    validateGroupRequiresHost,
    SITE_CODE_PATTERN,
} = require('../domain/meal-log.rules');

/** Tolerância para relógio adiantado do aparelho, em minutos. */
const CLOCK_SKEW_TOLERANCE_MINUTES = 5;

/** Recorte máximo de um relatório. Um trimestre. */
const MAX_REPORT_SPAN_DAYS = 92;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Data civil de um `Date`, em `YYYY-MM-DD`, no fuso do servidor. */
function toCivilDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function trimOrNull(value) {
    if (typeof value !== 'string') return value ?? null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

class MealUseCases {
    /**
     * @param {{ repository: import('./ports/meal-repository.port').MealRepositoryPort }} deps
     */
    constructor({ repository }) {
        this.repository = repository;
    }

    // ─── Comensais ──────────────────────────────────────────────────────────

    /**
     * Lista para o cache offline do aparelho.
     *
     * @param {{branchCode?: string, terminatedWindowDays?: number}} [filters]
     */
    async getDinersForCache(filters = {}) {
        const branchCode = trimOrNull(filters.branchCode);

        if (branchCode && !SITE_CODE_PATTERN.test(branchCode)) {
            throw new BadRequestError('branch_code tem que ter 4 dígitos (ex.: 0202).');
        }

        return this.repository.findDinersForCache({
            branchCode,
            terminatedWindowDays: filters.terminatedWindowDays,
        });
    }

    /**
     * Resolve a matrícula lida no QR (ou digitada) e devolve o que a tela
     * precisa: nome, centro de custo, situação de desligamento e quantas
     * refeições essa pessoa já fez hoje.
     */
    async lookupDiner({ companyCode, employeeId, branchCode }) {
        const key = {
            companyCode: trimOrNull(companyCode),
            employeeId: trimOrNull(employeeId),
            branchCode: trimOrNull(branchCode),
        };

        if (!key.companyCode || !key.employeeId || !key.branchCode) {
            throw new BadRequestError(
                'Informe empresa, matrícula e filial. A matrícula só é única dentro de uma empresa.'
            );
        }

        const serviceDate = toCivilDate(new Date());
        const diner = await this.repository.findDiner(key, serviceDate);

        if (!diner) {
            throw new AppError(
                'Matrícula não encontrada no Protheus. Confira o crachá ou registre pelo balde correspondente.',
                404,
                { code: 'DINER_NOT_FOUND' }
            );
        }

        return {
            ...diner,
            meals_today: Number(diner.meals_today ?? 0),
            alerts: this._buildAlerts(diner, Number(diner.meals_today ?? 0)),
        };
    }

    /**
     * Resolve a loja da sessão do operador.
     *
     * O `CK_meal_log_site_code` garante o formato de 4 dígitos, não a
     * existência — FK entre `GIPP` e `TMPPRD12` não é possível. Esta é a
     * checagem que resta, e ela roda uma vez ao abrir a sessão, não a cada
     * refeição servida.
     */
    async getSite(siteCode) {
        const code = trimOrNull(siteCode);

        if (!code || !SITE_CODE_PATTERN.test(code)) {
            throw new BadRequestError(
                'site_code tem que ser o código da filial com 4 dígitos (ex.: 0202). ' +
                'Nome de loja não serve: existem duas filiais chamadas Interlagos.'
            );
        }

        const branch = await this.repository.findBranch(code);
        if (!branch) {
            throw new AppError(`Filial ${code} não existe no cadastro do Protheus.`, 404, {
                code: 'SITE_NOT_FOUND',
            });
        }
        return branch;
    }

    // ─── Baldes ─────────────────────────────────────────────────────────────

    /** Os botões da tela. `siteCode` traz os da loja mais os que valem em todas. */
    async getDinerGroups({ siteCode, includeInactive = false } = {}) {
        const code = trimOrNull(siteCode);
        if (code && !SITE_CODE_PATTERN.test(code)) {
            throw new BadRequestError('site_code tem que ter 4 dígitos (ex.: 0202).');
        }
        return this.repository.findDinerGroups({ siteCode: code, onlyActive: !includeInactive });
    }

    async createDinerGroup(payload, actor) {
        const errors = this._validateDinerGroup(payload);
        if (errors.length) throw new BadRequestError(errors.join(' | '));

        return this.repository.insertDinerGroup(payload, actor);
    }

    async updateDinerGroup(id, fields, actor) {
        const group = await this.repository.findDinerGroupById(id);
        if (!group) {
            throw new AppError('Grupo não encontrado.', 404, { code: 'DINER_GROUP_NOT_FOUND' });
        }

        const errors = this._validateDinerGroup({ ...group, ...fields }, { partial: true });
        if (errors.length) throw new BadRequestError(errors.join(' | '));

        return this.repository.patchDinerGroup(id, fields, actor);
    }

    /** @private */
    _validateDinerGroup(payload, { partial = false } = {}) {
        const errors = [];

        if (!partial || payload.label !== undefined) {
            const label = trimOrNull(payload.label);
            if (!label) errors.push('label é obrigatório: é o texto do botão na tela.');
            else if (label.length > 60) errors.push('label tem no máximo 60 caracteres.');
        }

        if (payload.site_code !== undefined && payload.site_code !== null) {
            if (!SITE_CODE_PATTERN.test(String(payload.site_code))) {
                errors.push('site_code tem que ter 4 dígitos, ou ficar nulo para valer em todas as lojas.');
            }
        }

        // Faturável sem pagador é fatura sem destinatário — o balde existe
        // justamente para reconciliar contra a contratante.
        if (payload.billable && (payload.payee_id === undefined || payload.payee_id === null)) {
            errors.push('Grupo faturável precisa de payee_id: é contra quem a contratante reconcilia.');
        }

        return errors;
    }

    // ─── Registro de refeição ───────────────────────────────────────────────

    /**
     * Registra uma refeição servida.
     *
     * @param {object} input - Corpo da requisição.
     * @param {{userId: ?number}} actor
     * @param {{fromQueue?: boolean}} [options] - `true` quando veio da fila offline.
     */
    async registerMeal(input, actor, options = {}) {
        const payload = await this._buildMealLogPayload(input, actor, options);

        const { log, created } = await this.repository.insertMealLog(payload);

        if (!log) {
            throw new AppError('A refeição não foi registrada.', 500, { code: 'MEAL_NOT_PERSISTED' });
        }

        return {
            log,
            created,
            ...(payload._diner ? { diner: payload._diner } : {}),
            alerts: payload._alerts,
        };
    }

    /**
     * Descarrega a fila offline.
     *
     * Processa item a item e devolve o resultado de cada um. **Nunca aborta o
     * lote**: um registro inválido no meio de trinta não pode impedir os outros
     * vinte e nove de entrarem, senão o aparelho fica preso tentando sincronizar
     * a mesma fila para sempre.
     *
     * @param {object[]} logs
     * @param {{userId: ?number}} actor
     */
    async syncMealLogs(logs, actor) {
        if (!Array.isArray(logs) || logs.length === 0) {
            throw new BadRequestError('Envie um array `logs` com pelo menos um registro.');
        }

        const results = [];

        for (const [index, item] of logs.entries()) {
            try {
                const outcome = await this.registerMeal(item, actor, { fromQueue: true });
                results.push({
                    index,
                    client_uuid: item?.client_uuid ?? null,
                    status: outcome.created ? 'created' : 'duplicate',
                    id: outcome.log?.id ?? null,
                    alerts: outcome.alerts,
                });
            } catch (error) {
                const status = Number(error?.statusCode) || 500;
                const known = error instanceof AppError || error instanceof BadRequestError;

                results.push({
                    index,
                    client_uuid: item?.client_uuid ?? null,
                    status: 'failed',
                    error: known ? error.message : 'Falha ao registrar a refeição.',
                    /**
                     * O aparelho precisa saber se vale insistir. Dado inválido
                     * (4xx) não melhora com reenvio: o item tem que ser retido e
                     * mostrado a alguém. Falha técnica (5xx) é transitória e
                     * volta na próxima sincronização.
                     *
                     * Sem este campo a fila só conseguiria desistir por
                     * contagem de tentativas, e um registro envenenado
                     * consumiria uma tentativa por sincronização até o teto.
                     */
                    retryable: status >= 500,
                });
            }
        }

        const summary = {
            total: results.length,
            created: results.filter(r => r.status === 'created').length,
            duplicate: results.filter(r => r.status === 'duplicate').length,
            failed: results.filter(r => r.status === 'failed').length,
        };

        return { summary, results };
    }

    // ─── Relatórios ─────────────────────────────────────────────────────────

    /**
     * Valida e normaliza o recorte de datas.
     *
     * O recorte é OBRIGATÓRIO e limitado. `meal_log` cresce por volume de
     * refeição servida — 1.700 pessoas por dia útil — e `IX_meal_log_rpt` tem
     * `service_date` como primeira coluna da chave justamente para que uma
     * consulta com recorte seja um seek. Sem data, a mesma query vira varredura
     * da tabela inteira, e o relatório do RH começaria a derrubar a API no mês
     * seis.
     *
     * @private
     */
    _reportFilters({ dateFrom, dateTo, siteCode } = {}) {
        const from = trimOrNull(dateFrom);
        const to = trimOrNull(dateTo);

        if (!from || !to) {
            throw new BadRequestError(
                'Informe o período: date_from e date_to, no formato YYYY-MM-DD.'
            );
        }

        if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
            throw new BadRequestError('Datas no formato YYYY-MM-DD.');
        }

        if (from > to) {
            throw new BadRequestError('date_from não pode ser depois de date_to.');
        }

        const spanDays =
            (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;

        if (spanDays > MAX_REPORT_SPAN_DAYS) {
            throw new BadRequestError(
                `O período máximo é de ${MAX_REPORT_SPAN_DAYS} dias. ` +
                'Para consolidado de mais de um trimestre, peça por partes.'
            );
        }

        const site = trimOrNull(siteCode);
        if (site && !SITE_CODE_PATTERN.test(site)) {
            throw new BadRequestError('site_code tem que ter 4 dígitos (ex.: 0202).');
        }

        return { dateFrom: from, dateTo: to, siteCode: site };
    }

    /** Refeições por dia e por loja. */
    async getDailyReport(filters) {
        return this.repository.reportDaily(this._reportFilters(filters));
    }

    /**
     * Rateio por centro de custo.
     *
     * A chave do rateio é `company_code + cost_center`, nunca `cost_center`
     * sozinho: o código 19900 (DIRETORIA) existe em 6 empresas diferentes. Quem
     * consumir esta saída tem que agrupar pelas duas colunas — está garantido na
     * query, mas vale repetir aqui porque é o erro mais fácil de cometer na
     * camada de tela.
     */
    async getCostCenterReport(filters) {
        return this.repository.reportCostCenter(this._reportFilters(filters));
    }

    /** Refeições por contratante — a base do faturamento. */
    async getPayeeReport(filters) {
        return this.repository.reportPayee(this._reportFilters(filters));
    }

    /**
     * As duas exceções que a fase 1 existe para tratar: repetição no mesmo dia e
     * refeição servida a quem já estava desligado.
     *
     * Vêm juntas numa resposta só porque são a mesma pergunta do RH — "o que
     * preciso olhar?" — e separar em duas rotas obrigaria a tela a fazer duas
     * requisições para montar uma aba.
     */
    async getExceptionsReport(filters) {
        const normalized = this._reportFilters(filters);

        const [duplicates, terminated] = await Promise.all([
            this.repository.reportDuplicates(normalized),
            this.repository.reportTerminatedServed(normalized),
        ]);

        return {
            period: normalized,
            duplicates,
            terminated_served: terminated,
            summary: {
                duplicates: duplicates.length,
                terminated_served: terminated.length,
            },
        };
    }

    /**
     * Monta o registro que vai ao banco.
     *
     * Duas coisas o servidor decide, e não aceita do cliente:
     *
     *   `cost_center` — é SNAPSHOT do `RA_CC` no momento da gravação, resolvido
     *     pela view. Aceitar do cliente permitiria rateio inventado. Limitação
     *     conhecida: se a pessoa for transferida entre servir e sincronizar, o
     *     snapshot é o do sincronismo. Na prática a fila descarrega no mesmo
     *     dia, e o erro alternativo — confiar no aparelho — é pior.
     *
     *   `service_date` — a data civil derivada de `served_at`, nunca enviada
     *     solta. Assim não existe registro com data que não corresponde ao
     *     horário.
     *
     * @private
     */
    async _buildMealLogPayload(input = {}, actor = {}, { fromQueue = false } = {}) {
        const errors = validateMealLog(input);
        if (errors.length) throw new BadRequestError(errors.join(' | '));

        const now = new Date();
        const servedAt = this._resolveServedAt(input.served_at, now);

        const payload = {
            diner_type: Number(input.diner_type),
            company_code: null,
            employee_id: null,
            branch_code: null,
            diner_group_id: null,
            host_company_code: trimOrNull(input.host_company_code),
            host_employee_id: trimOrNull(input.host_employee_id),
            host_branch_code: trimOrNull(input.host_branch_code),
            guest_label: trimOrNull(input.guest_label),
            cost_center: null,
            site_code: trimOrNull(input.site_code),
            served_at: servedAt,
            service_date: toCivilDate(servedAt),
            meal_type: Number(input.meal_type),
            identified_by: Number(input.identified_by),
            match_score: input.match_score ?? null,
            operator_user_id: actor.userId ?? null,
            client_uuid: String(input.client_uuid),
            synced_at: fromQueue ? now : null,
            _alerts: [],
        };

        if (payload.diner_type === DINER_TYPE.EMPLOYEE) {
            await this._fillEmployee(payload, input);
        } else {
            await this._fillGroup(payload, input);
        }

        return payload;
    }

    /**
     * Relógio do aparelho não é fonte de verdade, mas é a melhor que existe para
     * uma refeição servida offline. A única correção aplicada é no futuro: um
     * `served_at` adiantado criaria refeição em data que ainda não chegou, e o
     * relatório do dia seguinte nasceria errado.
     *
     * @private
     */
    _resolveServedAt(value, now) {
        if (value === undefined || value === null || value === '') return now;

        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            throw new BadRequestError('served_at inválido: use ISO 8601.');
        }

        const toleranceMs = CLOCK_SKEW_TOLERANCE_MINUTES * 60 * 1000;
        return parsed.getTime() > now.getTime() + toleranceMs ? now : parsed;
    }

    /** @private */
    async _fillEmployee(payload, input) {
        const key = {
            companyCode: trimOrNull(input.company_code),
            employeeId: trimOrNull(input.employee_id),
            branchCode: trimOrNull(input.branch_code),
        };

        payload.company_code = key.companyCode;
        payload.employee_id = key.employeeId;
        payload.branch_code = key.branchCode;

        const diner = await this.repository.findDiner(key, payload.service_date);

        if (!diner) {
            throw new AppError(
                'Matrícula não encontrada no Protheus. Confira o crachá ou registre pelo balde correspondente.',
                404,
                { code: 'DINER_NOT_FOUND' }
            );
        }

        payload.cost_center = diner.cost_center ?? null;

        const mealsBefore = Number(diner.meals_today ?? 0);
        payload._diner = {
            company_code: diner.company_code,
            employee_id: diner.employee_id,
            branch_code: diner.branch_code,
            employee_name: diner.employee_name,
            cost_center: diner.cost_center,
            cost_center_description: diner.cost_center_description,
            is_terminated: diner.is_terminated,
            terminated_at: diner.terminated_at,
            meals_today: mealsBefore + 1,
        };
        payload._alerts = this._buildAlerts(diner, mealsBefore + 1);
    }

    /** @private */
    async _fillGroup(payload, input) {
        const groupId = Number(input.diner_group_id);
        const group = await this.repository.findDinerGroupById(groupId);

        if (!group || !group.is_active) {
            throw new AppError('Grupo não encontrado ou inativo.', 404, {
                code: 'DINER_GROUP_NOT_FOUND',
            });
        }

        const hostErrors = validateGroupRequiresHost(group, input);
        if (hostErrors.length) throw new BadRequestError(hostErrors.join(' | '));

        payload.diner_group_id = group.id;
        payload.identified_by = IDENTIFIED_BY.BUTTON;

        // Refeição de convidado cai no centro de custo de quem convidou — é o
        // que faz o almoço do fornecedor virar custo do comprador em vez de
        // custo sem dono.
        if (payload.host_employee_id) {
            const host = await this.repository.findDiner({
                companyCode: payload.host_company_code,
                employeeId: payload.host_employee_id,
                branchCode: payload.host_branch_code,
            }, payload.service_date);

            if (!host) {
                throw new AppError(
                    'Matrícula do anfitrião não encontrada no Protheus.',
                    404,
                    { code: 'HOST_NOT_FOUND' }
                );
            }

            payload.cost_center = host.cost_center ?? null;
            payload._alerts = host.is_terminated
                ? [{
                    code: 'HOST_TERMINATED',
                    severity: 'warning',
                    message: `O anfitrião ${host.employee_name} está desligado desde ${host.terminated_at}.`,
                }]
                : [];
        }

        payload._diner = {
            diner_group_id: group.id,
            label: group.label,
            billable: group.billable,
            payee_id: group.payee_id,
        };
    }

    /**
     * Sinais para a tela. Nenhum deles impede a refeição.
     * @private
     */
    _buildAlerts(diner, mealsToday) {
        const alerts = [];

        if (diner.is_terminated) {
            alerts.push({
                code: 'DINER_TERMINATED',
                severity: 'danger',
                message: `${diner.employee_name} está DESLIGADO desde ${diner.terminated_at}. ` +
                         'A refeição pode ser servida; o caso vai para o relatório do RH.',
            });
        }

        if (mealsToday > 1) {
            alerts.push({
                code: 'DINER_REPEATED',
                severity: 'warning',
                message: `${mealsToday}ª refeição de ${diner.employee_name} hoje.`,
            });
        }

        if (!diner.cost_center) {
            alerts.push({
                code: 'DINER_WITHOUT_COST_CENTER',
                severity: 'info',
                message: `${diner.employee_name} está sem centro de custo no Protheus — ` +
                         'a refeição entra no relatório sem rateio.',
            });
        }

        return alerts;
    }
}

module.exports = { MealUseCases, toCivilDate };
