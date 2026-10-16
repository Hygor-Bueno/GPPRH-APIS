/**
 * @fileoverview Regras puras da reserva: formato de data e hora, intervalo,
 * passado, sobreposição e o status que uma escrita produz. Antecedência, dias
 * bloqueados e folga de organização: `booking-window.rules`.
 *
 * Data e hora são hora LOCAL de parede, sempre como texto (`2026-10-08`,
 * `09:30`). Nada aqui passa por `Date` para comparar horário de reserva —
 * comparar texto de mesmo formato é exato e não depende de fuso.
 *
 * @module modules/global/domain/repp/booking.rules
 */

const { AppError } = require('../../../../errors/app.error');
const { BookingStatus, OCCUPYING_STATUSES, MAX_RANGE_DAYS, ReppErrorCode } = require('./repp.enums');

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
/** `09:30`, com `:00` de segundos opcional — o banco devolve TIME com segundos. */
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/;

const pad = (n) => String(n).padStart(2, '0');

/**
 * Data `YYYY-MM-DD` que existe no calendário (`2026-02-30` não passa).
 * @returns {string}
 */
function normalizeDate(value, field) {
    const match = DATE_PATTERN.exec(String(value ?? ''));
    if (match) {
        const [, y, m, d] = match.map(Number);
        const probe = new Date(Date.UTC(y, m - 1, d));
        if (probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d) {
            return match[0];
        }
    }
    throw new AppError(`O campo '${field}' deve ser uma data válida no formato AAAA-MM-DD.`, 400, { code: ReppErrorCode.InvalidDate });
}

/** Hora `HH:MM` (aceita `HH:MM:00`). @returns {string} sempre `HH:MM`. */
function normalizeTime(value, field) {
    const match = TIME_PATTERN.exec(String(value ?? ''));
    if (!match) throw new AppError(`O campo '${field}' deve ser uma hora válida no formato HH:MM.`, 400, { code: ReppErrorCode.InvalidTime });
    return `${match[1]}:${match[2]}`;
}

/** Fim estritamente depois do início, no mesmo dia (reserva não cruza meia-noite). */
function assertTimeOrder(startTime, endTime) {
    if (endTime <= startTime) {
        throw new AppError('A hora de fim deve ser maior que a hora de início.', 400, { code: ReppErrorCode.InvalidTimeRange });
    }
}

/** `YYYY-MM-DD HH:MM` local de um `Date` — o "agora" na mesma forma da reserva. */
function toLocalStamp(now) {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** A reserva (data + hora de início) já começou em relação a `now`? */
function hasStarted({ booking_date, start_time }, now) {
    return `${booking_date} ${start_time}` <= toLocalStamp(now);
}

/** Recusa criar ou mover reserva para data/hora que já passou. */
function assertNotPast(booking, now) {
    if (hasStarted(booking, now)) {
        throw new AppError('Não é possível reservar uma data ou hora que já passou.', 400, { code: ReppErrorCode.BookingInPast });
    }
}

/**
 * Intervalo da agenda: datas válidas, início ≤ fim e no máximo
 * `MAX_RANGE_DAYS` dias contando as duas pontas.
 * @returns {{start: string, end: string}}
 */
function normalizeRange(start, end) {
    const from = normalizeDate(start, 'start');
    const to = normalizeDate(end, 'end');
    if (to < from) throw new AppError("A data 'end' não pode ser anterior a 'start'.", 400, { code: ReppErrorCode.InvalidDateRange });

    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
    if (days > MAX_RANGE_DAYS) {
        throw new AppError(`O intervalo máximo de consulta é de ${MAX_RANGE_DAYS} dias.`, 400, { code: ReppErrorCode.DateRangeTooLong });
    }
    return { start: from, end: to };
}

/**
 * Período opcional de "minhas reservas": cada ponta é opcional, sem teto de
 * dias (a rota exige login e é paginada), mas `end` não pode vir antes de
 * `start`.
 * @returns {{start: ?string, end: ?string}}
 */
function normalizeOptionalRange(start, end) {
    const present = (value) => value !== undefined && value !== null && value !== '';
    const from = present(start) ? normalizeDate(start, 'start') : null;
    const to = present(end) ? normalizeDate(end, 'end') : null;
    if (from && to && to < from) {
        throw new AppError("A data 'end' não pode ser anterior a 'start'.", 400, { code: ReppErrorCode.InvalidDateRange });
    }
    return { start: from, end: to };
}

/**
 * Filtro `status` (um ou vários, separados por vírgula). Ausente = todos.
 * @returns {?string[]}
 */
function normalizeStatusFilter(value) {
    if (value === undefined || value === null || value === '') return null;
    const valid = Object.values(BookingStatus);
    const statuses = [...new Set(String(value).split(',').map((s) => s.trim()).filter(Boolean))];
    const invalid = statuses.filter((s) => !valid.includes(s));
    if (!statuses.length || invalid.length) {
        throw new AppError(`O parâmetro 'status' aceita: ${valid.join(', ')}.`, 400, { code: ReppErrorCode.InvalidStatus });
    }
    return statuses;
}

/**
 * Texto livre sem espaço nas pontas. `"   "` passa pelo validador da rota
 * (tamanho ≥ 1) e viraria um título invisível — aqui vira ausente.
 *
 * @param {*} value
 * @param {string} field
 * @param {{max: number, required?: boolean}} rules
 * @returns {?string}
 */
function normalizeText(value, field, { max, required = false }) {
    const text = value === undefined || value === null ? '' : String(value).trim();
    if (!text) {
        if (required) throw new AppError(`O campo '${field}' é obrigatório.`, 400, { code: ReppErrorCode.RequiredField });
        return null;
    }
    if (text.length > max) throw new AppError(`O campo '${field}' deve ter no máximo ${max} caracteres.`, 400, { code: ReppErrorCode.FieldTooLong });
    return text;
}

/**
 * Códigos do Protheus. Empresa tem 2 dígitos e filial 4, com zero à
 * esquerda significativo — continuam texto, nunca número.
 * @returns {{company_code: string, branch_code: string, cost_center_code: string}}
 */
function normalizeOrganizationCodes({ company_code, branch_code, cost_center_code }) {
    const company = normalizeText(company_code, 'company_code', { max: 2, required: true });
    const branch = normalizeText(branch_code, 'branch_code', { max: 4, required: true });
    const costCenter = normalizeText(cost_center_code, 'cost_center_code', { max: 20, required: true });
    if (!/^\d{2}$/.test(company)) throw new AppError("O campo 'company_code' deve ter 2 dígitos.", 400, { code: ReppErrorCode.InvalidOrganizationCode });
    if (!/^\d{4}$/.test(branch)) throw new AppError("O campo 'branch_code' deve ter 4 dígitos.", 400, { code: ReppErrorCode.InvalidOrganizationCode });
    return { company_code: company, branch_code: branch, cost_center_code: costCenter };
}

const ORGANIZATION_FIELDS = ['company_code', 'branch_code', 'cost_center_code'];

const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';

/** Se o corpo traz algum código organizacional de fato preenchido. */
function hasOrganizationInput(input) {
    return ORGANIZATION_FIELDS.some((field) => !isBlank(input[field]));
}

/**
 * Códigos organizacionais do corpo, campo a campo, caindo para `fallback`
 * (sessão no create, reserva atual no update) quando o campo não veio.
 *
 * Vazio conta como "não informado", e não só `undefined`/`null`: o front
 * pré-preenche o formulário pelo `/me`, então quem não tem vínculo no Protheus
 * (ou limpou o campo) manda `""` — e com `??` isso nunca caía para a sessão.
 *
 * Sem código nem no corpo nem no fallback, o login não achou o vínculo do
 * usuário no Protheus (usuário de loja, matrícula fora da SRA etc.): erro
 * próprio para o front pedir a seleção em vez de culpar o formulário.
 *
 * @param {object} input
 * @param {object} fallback
 * @returns {{company_code: *, branch_code: *, cost_center_code: *}}
 */
function pickOrganizationCodes(input, fallback) {
    const codes = Object.fromEntries(ORGANIZATION_FIELDS.map((field) => [
        field,
        isBlank(input[field]) ? fallback?.[field] : input[field],
    ]));
    const missing = ORGANIZATION_FIELDS.filter((field) => isBlank(codes[field]));
    if (missing.length) {
        throw new AppError(
            'Não foi possível identificar empresa, filial e centro de custo pelo seu cadastro. Selecione-os na reserva.',
            400,
            { code: ReppErrorCode.OrganizationUnknown, details: { missing } },
        );
    }
    return codes;
}

/** Id positivo de rota/corpo, ou `null` quando inválido (quem chama decide 400 ou 404). */
function parseId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

/** O status ocupa o horário (entra na checagem de conflito e na agenda)? */
function isOccupying(status) {
    return OCCUPYING_STATUSES.includes(status);
}

/** Dois intervalos `[início, fim)` do mesmo dia se cruzam? Encostar (10:00–11:00 e 11:00–12:00) não é conflito. */
function overlaps(a, b) {
    return a.start_time < b.end_time && a.end_time > b.start_time;
}

/**
 * Status de uma reserva nova: quem administra o espaço (ou é dono do
 * sistema) reserva direto; os demais entram na fila de aprovação.
 */
function initialStatus(canReview) {
    return canReview ? BookingStatus.Approved : BookingStatus.Pending;
}

/** A edição mexe no que exige nova aprovação (espaço, data ou horário)? */
function isSchedulingChange(current, next) {
    return current.space_id !== next.space_id
        || current.booking_date !== next.booking_date
        || current.start_time !== next.start_time
        || current.end_time !== next.end_time;
}

/**
 * Status depois de uma edição.
 *
 * Só troca de espaço/data/horário feita por quem NÃO pode aprovar no espaço
 * de destino devolve a reserva à fila — e solta o horário antigo, porque a
 * reserva passa a ocupar só o novo (decisão do Hygor, 08/10/2026). Quem pode
 * aprovar edita sem mudar o status: editar uma pendente não a aprova por
 * tabela; aprovar continua sendo uma ação explícita.
 */
function statusAfterEdit({ current, next, canReviewTarget }) {
    if (isSchedulingChange(current, next) && !canReviewTarget) return BookingStatus.Pending;
    return current.status;
}

/** `60` → `1 hora`, `90` → `90 minutos`. */
function formatMinutes(minutes) {
    if (minutes % 60 !== 0) return `${minutes} minutos`;
    const hours = minutes / 60;
    return hours === 1 ? '1 hora' : `${hours} horas`;
}

/**
 * Erro 409 de conflito. Informa só o intervalo ocupado — nada de quem
 * reservou, título ou empresa: a mensagem chega a quem não pode ver isso.
 *
 * `kind = 'setup'`: os horários não se cruzam, mas a nova reserva invade a
 * folga de organização da existente (`re_spaces.setup_minutes`). `blocked` é
 * a reserva existente com a folga dos dois lados — o trecho que ninguém pode
 * ocupar.
 *
 * @param {{start_time: string, end_time: string}} conflict
 * @param {{kind?: 'overlap'|'setup', setupMinutes?: number, blocked?: ?{start_time: string, end_time: string}}} [context]
 */
function conflictError(conflict, { kind = 'overlap', setupMinutes = 0, blocked = null } = {}) {
    const range = { start_time: conflict.start_time, end_time: conflict.end_time };
    const window = blocked ?? range;
    const message = kind === 'setup'
        ? `Este espaço exige um intervalo de ${formatMinutes(setupMinutes)} entre reservas para organização. Há uma reserva das ${range.start_time} às ${range.end_time}, então o intervalo das ${window.start_time} às ${window.end_time} fica bloqueado.`
        : `O horário conflita com uma reserva existente das ${range.start_time} às ${range.end_time}.`;
    const error = new AppError(message, 409, { code: ReppErrorCode.BookingConflict });
    error.fields = { conflict: range, reason: kind, setup_minutes: setupMinutes, blocked: window };
    return error;
}

module.exports = {
    normalizeDate,
    normalizeTime,
    assertTimeOrder,
    toLocalStamp,
    hasStarted,
    assertNotPast,
    normalizeRange,
    normalizeOptionalRange,
    normalizeStatusFilter,
    normalizeText,
    normalizeOrganizationCodes,
    hasOrganizationInput,
    pickOrganizationCodes,
    parseId,
    isOccupying,
    overlaps,
    initialStatus,
    isSchedulingChange,
    statusAfterEdit,
    formatMinutes,
    conflictError,
};
