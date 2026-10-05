/**
 * @fileoverview Normalização dos filtros da visão de supervisão (diretoria) do
 * GTPP — sem I/O. Converte a query string crua num objeto de filtros tipado e
 * rejeita combinações ambíguas antes de qualquer ida ao banco.
 *
 * @module modules/global/domain/gtpp/task-overview/task-overview-filter.rules
 */

const { AppError } = require('../../../../../errors/app.error');
const { TASK_STATE } = require('../task/task-state.enum');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_STATE_IDS = 10;
const MAX_SEARCH_LENGTH = 100;

/** Papel do usuário filtrado na tarefa. */
const UserRole = Object.freeze({
    ANY: 'any',         // criador OU participante
    CREATOR: 'creator',
    MEMBER: 'member',   // vinculado em gt_task_user
});

/** Estados que encerram a tarefa — não contam como "atrasada". */
const CLOSED_STATES = Object.freeze([TASK_STATE.DONE, TASK_STATE.CANCELED, TASK_STATE.ARCHIVED]);

const COMPANY_PATTERN = /^\d{2}$/;
const BRANCH_PATTERN = /^\d{4}$/;
const COST_CENTER_PATTERN = /^[A-Za-z0-9]{1,20}$/;
const REGISTRATION_PATTERN = /^[A-Za-z0-9]{1,20}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isBlank(value) {
    return value === undefined || value === null || String(value).trim() === '';
}

function parsePositiveInt(value, field) {
    if (isBlank(value)) return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw new AppError(`O parâmetro '${field}' deve ser um inteiro positivo.`, 400);
    return n;
}

function parseNonNegativeInt(value, field) {
    if (isBlank(value)) return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) throw new AppError(`O parâmetro '${field}' deve ser um inteiro maior ou igual a zero.`, 400);
    return n;
}

function parseCode(value, field, pattern) {
    if (isBlank(value)) return null;
    const code = String(value).trim();
    if (!pattern.test(code)) throw new AppError(`O parâmetro '${field}' está em formato inválido.`, 400);
    return code;
}

function parseDate(value, field) {
    if (isBlank(value)) return null;
    const date = String(value).trim();
    if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
        throw new AppError(`O parâmetro '${field}' deve estar no formato AAAA-MM-DD.`, 400);
    }
    return date;
}

function parseStateIds(value) {
    if (isBlank(value)) return [];
    const ids = String(value).split(',').map(s => s.trim()).filter(Boolean).map(s => parsePositiveInt(s, 'state_ids'));
    const unique = [...new Set(ids)];
    if (unique.length > MAX_STATE_IDS) throw new AppError(`Máximo de ${MAX_STATE_IDS} estados por requisição.`, 400);
    return unique;
}

function parseBoolean(value, field) {
    if (isBlank(value)) return false;
    const v = String(value).trim().toLowerCase();
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
    throw new AppError(`O parâmetro '${field}' deve ser true ou false.`, 400);
}

/**
 * @param {object} [query] - `req.query` cru
 * @returns {{
 *   userId: number|null, employeeRegistration: string|null, employeeBranch: string|null,
 *   userRole: string,
 *   companyCode: string|null, branchCode: string|null, costCenterCode: string|null,
 *   stateIds: number[], priority: number|null, search: string|null,
 *   dueFrom: string|null, dueTo: string|null, overdue: boolean,
 *   page: number, limit: number,
 * }}
 * @throws {AppError} 400 para qualquer parâmetro inválido ou combinação ambígua
 */
function normalizeOverviewFilters(query = {}) {
    const userId = parsePositiveInt(query.user_id, 'user_id');

    // Colaborador escolhido na busca do Protheus. A matrícula não é única entre
    // filiais (a 000003 existe na 0601 e na 0901), por isso vem sempre em par.
    const employeeRegistration = parseCode(query.employee_registration, 'employee_registration', REGISTRATION_PATTERN);
    const employeeBranch       = parseCode(query.employee_branch, 'employee_branch', BRANCH_PATTERN);
    if (Boolean(employeeRegistration) !== Boolean(employeeBranch)) {
        throw new AppError("Os parâmetros 'employee_registration' e 'employee_branch' devem ser enviados juntos.", 400);
    }
    if (employeeRegistration && userId != null) {
        throw new AppError("Use 'user_id' ou 'employee_registration', não os dois.", 400);
    }

    const userRole = isBlank(query.user_role) ? UserRole.ANY : String(query.user_role).trim().toLowerCase();
    if (!Object.values(UserRole).includes(userRole)) {
        throw new AppError(`O parâmetro 'user_role' deve ser um destes valores: ${Object.values(UserRole).join(', ')}.`, 400);
    }
    if (userRole !== UserRole.ANY && userId == null && !employeeRegistration) {
        throw new AppError("O parâmetro 'user_role' exige 'user_id' ou 'employee_registration'.", 400);
    }

    // Empresa/unidade/CC são do CRIADOR da tarefa. A filial do Protheus sempre
    // começa com o código da empresa (0601 → 06), então a unidade sozinha já
    // determina a empresa.
    const branchCode     = parseCode(query.branch_code, 'branch_code', BRANCH_PATTERN);
    let   companyCode    = parseCode(query.company_code, 'company_code', COMPANY_PATTERN);
    const costCenterCode = parseCode(query.cost_center_code, 'cost_center_code', COST_CENTER_PATTERN);

    if (branchCode) {
        const branchCompany = branchCode.slice(0, 2);
        if (companyCode && companyCode !== branchCompany) {
            throw new AppError(`A unidade ${branchCode} não pertence à empresa ${companyCode}.`, 400);
        }
        companyCode = branchCompany;
    }

    // O mesmo código de centro de custo existe em empresas diferentes.
    if (costCenterCode && !companyCode) {
        throw new AppError("O filtro 'cost_center_code' exige 'company_code' ou 'branch_code'.", 400);
    }

    const search = isBlank(query.search) ? null : String(query.search).trim();
    if (search && search.length > MAX_SEARCH_LENGTH) {
        throw new AppError(`O parâmetro 'search' deve ter no máximo ${MAX_SEARCH_LENGTH} caracteres.`, 400);
    }

    const dueFrom = parseDate(query.due_from, 'due_from');
    const dueTo   = parseDate(query.due_to, 'due_to');
    if (dueFrom && dueTo && dueFrom > dueTo) {
        throw new AppError("O parâmetro 'due_from' não pode ser posterior a 'due_to'.", 400);
    }

    const page  = parsePositiveInt(query.page, 'page') ?? 1;
    const limit = Math.min(parsePositiveInt(query.limit, 'limit') ?? DEFAULT_LIMIT, MAX_LIMIT);

    return {
        userId,
        employeeRegistration,
        employeeBranch,
        userRole,
        companyCode,
        branchCode,
        costCenterCode,
        stateIds: parseStateIds(query.state_ids),
        priority: parseNonNegativeInt(query.priority, 'priority'),
        search,
        dueFrom,
        dueTo,
        overdue: parseBoolean(query.overdue, 'overdue'),
        page,
        limit,
    };
}

module.exports = { normalizeOverviewFilters, UserRole, CLOSED_STATES, MAX_LIMIT, DEFAULT_LIMIT };
