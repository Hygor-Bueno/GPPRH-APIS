/**
 * @fileoverview Controllers — controle de refeitório.
 * @module modules/meal/controllers/meal.controller
 */

const { MealUseCases } = require('../application/meal.use-cases');
const { SqlServerMealRepository } = require('../infrastructure/sqlserver-meal.repository');
const { respond } = require('../../../utils/respond');

const useCases = new MealUseCases({
    repository: new SqlServerMealRepository(),
});

/** Extrai o operador do token. Nunca do corpo da requisição. */
function actorFrom(req) {
    return {
        userId: req.user?.id ?? null,
        branchCode: req.user?.branch_code != null ? String(req.user.branch_code) : null,
    };
}

// ─── Comensais ────────────────────────────────────────────────────────────────

/**
 * `GET /meal/diners`
 *
 * Lista para o cache offline. Sem `branch_code` devolve o grupo inteiro — é o
 * padrão de propósito: alguém lotado em 0203 almoçando no 0202 é caso real, e
 * filtrar por filial deixaria essa pessoa sem atendimento justamente quando a
 * rede caiu.
 */
async function getDiners(req, res) {
    const { branch_code, branchCode, terminated_window_days } = req.query;

    const data = await useCases.getDinersForCache({
        branchCode: branch_code ?? branchCode,
        terminatedWindowDays: terminated_window_days !== undefined
            ? Number(terminated_window_days)
            : undefined,
    });

    return respond.ok(res, data);
}

/** `GET /meal/diners/:companyCode/:branchCode/:employeeId` — resolve o QR. */
async function getDiner(req, res) {
    const { companyCode, branchCode, employeeId } = req.params;

    const data = await useCases.lookupDiner({ companyCode, branchCode, employeeId });
    return respond.ok(res, data);
}

/** `GET /meal/sites/:siteCode` — confere a loja ao abrir a sessão do operador. */
async function getSite(req, res) {
    const data = await useCases.getSite(req.params.siteCode);
    return respond.ok(res, data);
}

// ─── Baldes ───────────────────────────────────────────────────────────────────

/** `GET /meal/diner-groups` — os botões da tela. */
async function getDinerGroups(req, res) {
    const { site_code, siteCode, include_inactive } = req.query;

    const data = await useCases.getDinerGroups({
        siteCode: site_code ?? siteCode,
        includeInactive: include_inactive === 'true' || include_inactive === true,
    });

    return respond.ok(res, data);
}

/** `POST /meal/diner-groups` — categoria nova é um INSERT, sem release do app. */
async function postDinerGroup(req, res) {
    const data = await useCases.createDinerGroup(req.body, actorFrom(req));
    return respond.created(res, data);
}

/**
 * `PATCH /meal/diner-groups/:id`
 *
 * Desativar um botão é `is_active = 0`, nunca DELETE: a FK é `NO_ACTION` e um
 * grupo com refeição registrada não pode desaparecer sem levar o histórico de
 * custo com ele.
 */
async function patchDinerGroup(req, res) {
    const data = await useCases.updateDinerGroup(Number(req.params.id), req.body, actorFrom(req));
    return respond.ok(res, data);
}

// ─── Registro de refeição ─────────────────────────────────────────────────────

/**
 * `POST /meal/logs`
 *
 * Devolve **201 quando gravou** e **200 quando o `client_uuid` já existia**. A
 * distinção existe para o aparelho poder limpar a fila em qualquer um dos dois
 * casos: reenvio não é erro, é a mesma refeição.
 */
async function postMealLog(req, res) {
    const outcome = await useCases.registerMeal(req.body, actorFrom(req));

    const body = {
        log: outcome.log,
        diner: outcome.diner ?? null,
        alerts: outcome.alerts ?? [],
        duplicate_submission: !outcome.created,
    };

    return outcome.created ? respond.created(res, body) : respond.ok(res, body);
}

/**
 * `POST /meal/logs/sync` — descarrega a fila offline.
 *
 * Sempre 200, mesmo com item falhando. O status de cada registro vem em
 * `results[]`: um inválido no meio de trinta não pode impedir os outros de
 * entrarem, senão o aparelho fica preso tentando sincronizar a mesma fila para
 * sempre.
 */
async function postMealLogSync(req, res) {
    const logs = Array.isArray(req.body) ? req.body : req.body?.logs;

    const data = await useCases.syncMealLogs(logs, actorFrom(req));
    return respond.ok(res, data);
}

// ─── Relatórios ───────────────────────────────────────────────────────────────

/** O recorte de datas é obrigatório em todos — ver `_reportFilters`. */
function reportFiltersFrom(req) {
    const { date_from, dateFrom, date_to, dateTo, site_code, siteCode } = req.query;

    return {
        dateFrom: date_from ?? dateFrom,
        dateTo: date_to ?? dateTo,
        siteCode: site_code ?? siteCode,
    };
}

/** `GET /meal/reports/daily` */
async function getDailyReport(req, res) {
    const data = await useCases.getDailyReport(reportFiltersFrom(req));
    return respond.ok(res, data);
}

/** `GET /meal/reports/cost-center` — rateio por `company_code` + `cost_center`. */
async function getCostCenterReport(req, res) {
    const data = await useCases.getCostCenterReport(reportFiltersFrom(req));
    return respond.ok(res, data);
}

/** `GET /meal/reports/payee` — a base do faturamento da contratante. */
async function getPayeeReport(req, res) {
    const data = await useCases.getPayeeReport(reportFiltersFrom(req));
    return respond.ok(res, data);
}

/**
 * `GET /meal/reports/exceptions`
 *
 * Repetição no mesmo dia e refeição de desligado. São as duas coisas que o MVP
 * não fazia e que justificam a fase 1 — o ganho não é digitalizar a contagem.
 */
async function getExceptionsReport(req, res) {
    const data = await useCases.getExceptionsReport(reportFiltersFrom(req));
    return respond.ok(res, data);
}

module.exports = {
    getDailyReport,
    getCostCenterReport,
    getPayeeReport,
    getExceptionsReport,
    getDiners,
    getDiner,
    getSite,
    getDinerGroups,
    postDinerGroup,
    patchDinerGroup,
    postMealLog,
    postMealLogSync,
};
