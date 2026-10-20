/**
 * @fileoverview Cadastro dos espaços da REPP: o que se grava em `re_spaces` e
 * quem muda cada campo.
 *
 * | Campo                              | Quem muda                              |
 * |------------------------------------|----------------------------------------|
 * | `name`, `description`, `active`    | dono do sistema                        |
 * | `blocked_weekdays`, `setup_minutes`| dono do sistema ou admin do espaço     |
 *
 * Criar é só do dono, e o espaço já nasce com pelo menos um administrador
 * ativo — a mesma garantia de `space-admin.rules`: sem administrador, pedido
 * pendente não avisa ninguém.
 *
 * Não há exclusão: desativar (`active = false`) tira o espaço do `GET /spaces`
 * e recusa reserva nova, sem mexer nas reservas já gravadas.
 *
 * A edição compara com o espaço atual e só conta o que MUDOU: o front pode
 * mandar o formulário inteiro, e o administrador do espaço que reenvia o nome
 * sem alterar não leva 403.
 *
 * @module modules/global/domain/repp/space.rules
 */

const { AppError } = require('../../../../errors/app.error');
const { MAX_SETUP_MINUTES, ReppErrorCode } = require('./repp.enums');
const { normalizeText, parseId } = require('./booking.rules');
const { canReviewSpace } = require('./booking-access.rules');

const NAME_MAX = 100;
const DESCRIPTION_MAX = 255;

/** Campos de agenda: o administrador do espaço também muda. */
const AGENDA_FIELDS = Object.freeze(['blocked_weekdays', 'setup_minutes']);
/** Campos de cadastro: só o dono. */
const REGISTRY_FIELDS = Object.freeze(['name', 'description', 'active']);

/** Pode criar espaço e mudar nome, descrição e situação? */
function canManageSpaces(viewer) {
    return viewer.isOwner;
}

/** Pode mudar os dias bloqueados e a folga do espaço? */
function canEditSpaceAgenda(viewer, spaceId) {
    return canReviewSpace(viewer, spaceId);
}

/**
 * `[2, 4]` (ou `['2', '4']`) → `[2, 4]` ordenado e sem repetição. `[]` =
 * nenhum dia bloqueado. Diferente do `parseWeekdays` (que lê o banco e
 * tolera lixo), aqui valor inválido é recusado.
 * @returns {number[]}
 */
function normalizeWeekdays(value) {
    const invalid = () => new AppError(
        "O campo 'blocked_weekdays' deve ser uma lista de dias da semana de 1 (segunda) a 7 (domingo).",
        400,
        { code: ReppErrorCode.InvalidWeekdays },
    );
    if (!Array.isArray(value)) throw invalid();
    const days = value.map((day) => (typeof day === 'string' && day.trim() !== '' ? Number(day) : day));
    if (!days.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)) throw invalid();
    return [...new Set(days)].sort((a, b) => a - b);
}

/** Minutos inteiros de 0 a `MAX_SETUP_MINUTES`. */
function normalizeSetupMinutes(value) {
    const minutes = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_SETUP_MINUTES) {
        throw new AppError(
            `O campo 'setup_minutes' deve ser um número inteiro de minutos entre 0 e ${MAX_SETUP_MINUTES}.`,
            400,
            { code: ReppErrorCode.InvalidSetupMinutes },
        );
    }
    return minutes;
}

function normalizeActive(value) {
    if (typeof value !== 'boolean') {
        throw new AppError("O campo 'active' deve ser verdadeiro ou falso.", 400, { code: ReppErrorCode.InvalidActive });
    }
    return value;
}

/** Ids dos administradores iniciais: pelo menos um, positivos, sem repetição. */
function normalizeAdminIds(value) {
    if (!Array.isArray(value) || value.length === 0) {
        throw new AppError(
            'Informe pelo menos um administrador para o espaço.',
            400,
            { code: ReppErrorCode.SpaceAdminRequired },
        );
    }
    const ids = value.map(parseId);
    if (ids.some((id) => id === null)) {
        throw new AppError('Usuário não encontrado.', 404, { code: ReppErrorCode.UserNotFound });
    }
    return [...new Set(ids)];
}

/**
 * Corpo do `POST /spaces`.
 * @returns {{name: string, description: ?string, blocked_weekdays: number[], setup_minutes: number, admin_user_ids: number[]}}
 */
function normalizeNewSpace(input = {}) {
    return {
        name: normalizeText(input.name, 'name', { max: NAME_MAX, required: true }),
        description: normalizeText(input.description, 'description', { max: DESCRIPTION_MAX }),
        blocked_weekdays: input.blocked_weekdays === undefined || input.blocked_weekdays === null
            ? [] : normalizeWeekdays(input.blocked_weekdays),
        setup_minutes: input.setup_minutes === undefined || input.setup_minutes === null
            ? 0 : normalizeSetupMinutes(input.setup_minutes),
        admin_user_ids: normalizeAdminIds(input.admin_user_ids),
    };
}

const sameWeekdays = (a, b) => a.length === b.length && a.every((day, i) => day === b[i]);

/**
 * Corpo do `PUT /spaces/:id` contra o espaço atual. Campo ausente fica como
 * está; `description` vazia ou `null` apaga a descrição.
 *
 * @param {{name: string, description: ?string, blocked_weekdays: number[], setup_minutes: number, active: boolean}} current
 * @param {object} input
 * @returns {object} só os campos que mudam, já normalizados (`{}` = nada a fazer).
 */
function spaceChanges(current, input = {}) {
    const next = {};
    if (input.name !== undefined) next.name = normalizeText(input.name, 'name', { max: NAME_MAX, required: true });
    if (input.description !== undefined) next.description = normalizeText(input.description, 'description', { max: DESCRIPTION_MAX });
    if (input.active !== undefined) next.active = normalizeActive(input.active);
    if (input.blocked_weekdays !== undefined) next.blocked_weekdays = normalizeWeekdays(input.blocked_weekdays ?? []);
    if (input.setup_minutes !== undefined) next.setup_minutes = normalizeSetupMinutes(input.setup_minutes ?? 0);

    const changes = {};
    for (const [field, value] of Object.entries(next)) {
        const unchanged = field === 'blocked_weekdays'
            ? sameWeekdays(value, current.blocked_weekdays)
            : value === (current[field] ?? null);
        if (!unchanged) changes[field] = value;
    }
    return changes;
}

/**
 * Recusa a edição de quem não pode mudar algum dos campos alterados.
 * @param {object} viewer
 * @param {number} spaceId
 * @param {string[]} fields - as chaves de `spaceChanges`.
 */
function assertCanEditSpace(viewer, spaceId, fields) {
    if (canManageSpaces(viewer)) return;
    if (!canEditSpaceAgenda(viewer, spaceId)) {
        throw new AppError(
            'Somente o administrador do espaço ou o dono do sistema pode alterar o espaço.',
            403,
            { code: ReppErrorCode.NotSpaceAdmin },
        );
    }
    const registry = fields.filter((field) => REGISTRY_FIELDS.includes(field));
    if (registry.length) {
        const error = new AppError(
            'O administrador do espaço altera só os dias bloqueados e a folga de organização. Nome, descrição e situação são alterados pelo dono do sistema.',
            403,
            { code: ReppErrorCode.ManageSpacesForbidden },
        );
        error.fields = { forbidden: registry };
        throw error;
    }
}

/** `[2, 4]` → `'2,4'` (a coluna `re_spaces.blocked_weekdays`). */
function weekdaysToColumn(days) {
    return days.join(',');
}

module.exports = {
    AGENDA_FIELDS,
    REGISTRY_FIELDS,
    canManageSpaces,
    canEditSpaceAgenda,
    normalizeWeekdays,
    normalizeSetupMinutes,
    normalizeAdminIds,
    normalizeNewSpace,
    spaceChanges,
    assertCanEditSpace,
    weekdaysToColumn,
};
