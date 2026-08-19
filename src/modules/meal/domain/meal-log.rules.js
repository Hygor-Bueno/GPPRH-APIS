/**
 * @fileoverview Domínio — regras de um registro de refeição.
 *
 * Estas regras repetem, em JavaScript, o que `CK_meal_log_diner`,
 * `CK_meal_log_host` e `CK_meal_log_site_code` já garantem no banco. A
 * duplicação é deliberada e tem uma razão só: a constraint devolve
 * "conflitou com a restrição do CHECK", que é a mensagem certa para um DBA e
 * inútil para o operador com 300 pessoas na fila. Aqui o erro vira texto que
 * diz o que fazer.
 *
 * O banco continua sendo a autoridade. Se alguma regra daqui divergir de lá,
 * quem manda é lá — e o `INSERT` falha, como deve.
 *
 * @module modules/meal/domain/meal-log.rules
 */

const {
    DINER_TYPE,
    MEAL_TYPES,
    IDENTIFIED_BY,
    EMPLOYEE_IDENTIFICATION,
} = require('./meal.enums');

/** `M0_CODFIL`: quatro dígitos, nada mais. Espelha CK_meal_log_site_code. */
const SITE_CODE_PATTERN = /^[0-9]{4}$/;

/** Empresa: dois dígitos, o sufixo da tabela SRAxxx. */
const COMPANY_CODE_PATTERN = /^[0-9]{2}$/;

/** Matrícula: RA_MAT, até 6 posições. */
const EMPLOYEE_ID_PATTERN = /^[0-9A-Za-z]{1,6}$/;

const UUID_PATTERN =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isBlank(value) {
    return value === undefined || value === null || String(value).trim() === '';
}

/**
 * Valida um registro de refeição antes de chegar ao banco.
 *
 * @param {object} payload
 * @returns {string[]} Lista de erros; vazia quando o registro é válido.
 */
function validateMealLog(payload = {}) {
    const errors = [];

    const dinerType = Number(payload.diner_type);
    const mealType = Number(payload.meal_type);
    const identifiedBy = Number(payload.identified_by);

    // ─── Loja onde a refeição foi servida ───────────────────────────────────
    if (isBlank(payload.site_code)) {
        errors.push('site_code é obrigatório: é a loja onde a refeição foi servida.');
    } else if (!SITE_CODE_PATTERN.test(String(payload.site_code))) {
        errors.push(
            'site_code tem que ser o código da filial com 4 dígitos (ex.: 0202). ' +
            'Nome de loja não serve: existem duas filiais chamadas Interlagos.'
        );
    }

    // ─── Chave da fila offline ──────────────────────────────────────────────
    if (isBlank(payload.client_uuid)) {
        errors.push('client_uuid é obrigatório: é o que impede o reenvio de duplicar a refeição.');
    } else if (!UUID_PATTERN.test(String(payload.client_uuid))) {
        errors.push('client_uuid tem que ser um UUID.');
    }

    // ─── Tipo de refeição ───────────────────────────────────────────────────
    if (!MEAL_TYPES.includes(mealType)) {
        errors.push(`meal_type inválido: use ${MEAL_TYPES.join(', ')}.`);
    }

    // ─── Quem comeu ─────────────────────────────────────────────────────────
    if (dinerType === DINER_TYPE.EMPLOYEE) {
        errors.push(...validateEmployeeDiner(payload, identifiedBy));
    } else if (dinerType === DINER_TYPE.GROUP) {
        errors.push(...validateGroupDiner(payload, identifiedBy));
    } else {
        errors.push(
            `diner_type inválido: ${DINER_TYPE.EMPLOYEE} para colaborador, ` +
            `${DINER_TYPE.GROUP} para grupo sem matrícula.`
        );
    }

    // ─── Convidante: tudo ou nada ───────────────────────────────────────────
    errors.push(...validateHost(payload));

    // ─── Score só existe quando o rosto identificou ─────────────────────────
    if (payload.match_score !== undefined && payload.match_score !== null
        && identifiedBy !== IDENTIFIED_BY.FACIAL) {
        errors.push('match_score só faz sentido quando identified_by é facial.');
    }

    return errors;
}

/** Colaborador: a chave do Protheus tem três partes, e meia chave não serve. */
function validateEmployeeDiner(payload, identifiedBy) {
    const errors = [];

    if (isBlank(payload.company_code)) {
        errors.push('company_code é obrigatório para colaborador: a matrícula só é única dentro de uma empresa.');
    } else if (!COMPANY_CODE_PATTERN.test(String(payload.company_code))) {
        errors.push('company_code tem que ter 2 dígitos (01 a 09).');
    }

    if (isBlank(payload.employee_id)) {
        errors.push('employee_id (RA_MAT) é obrigatório para colaborador.');
    } else if (!EMPLOYEE_ID_PATTERN.test(String(payload.employee_id))) {
        errors.push('employee_id tem no máximo 6 caracteres.');
    }

    if (isBlank(payload.branch_code)) {
        errors.push('branch_code (RA_FILIAL) é obrigatório para colaborador.');
    } else if (!SITE_CODE_PATTERN.test(String(payload.branch_code))) {
        errors.push('branch_code tem que ter 4 dígitos.');
    }

    if (!isBlank(payload.diner_group_id)) {
        errors.push('diner_group_id não pode vir junto de uma matrícula: ou é colaborador, ou é balde.');
    }

    if (!EMPLOYEE_IDENTIFICATION.includes(identifiedBy)) {
        errors.push(
            `identified_by inválido para colaborador: use ${EMPLOYEE_IDENTIFICATION.join(', ')}. ` +
            `${IDENTIFIED_BY.BUTTON} (botão) é do balde.`
        );
    }

    return errors;
}

/** Balde: não tem matrícula, não tem empresa, não tem filial. */
function validateGroupDiner(payload, identifiedBy) {
    const errors = [];

    if (isBlank(payload.diner_group_id)) {
        errors.push('diner_group_id é obrigatório para grupo sem matrícula.');
    } else if (!Number.isInteger(Number(payload.diner_group_id)) || Number(payload.diner_group_id) < 1) {
        errors.push('diner_group_id tem que ser um id inteiro.');
    }

    for (const field of ['company_code', 'employee_id', 'branch_code']) {
        if (!isBlank(payload[field])) {
            errors.push(`${field} não se aplica a grupo sem matrícula — o balde é contado, não identificado.`);
        }
    }

    if (identifiedBy !== IDENTIFIED_BY.BUTTON) {
        errors.push(`identified_by para grupo é sempre ${IDENTIFIED_BY.BUTTON} (botão).`);
    }

    return errors;
}

/**
 * Convidante: as três colunas host_*, ou nenhuma.
 *
 * "Visitante convidado pela matrícula 000123 de empresa nenhuma" não permite
 * rateio nem cobrança — é dado que parece dado.
 */
function validateHost(payload) {
    const errors = [];
    const parts = ['host_company_code', 'host_employee_id', 'host_branch_code'];
    const filled = parts.filter(field => !isBlank(payload[field]));

    if (filled.length === 0 || filled.length === parts.length) {
        if (filled.length === parts.length) {
            if (!COMPANY_CODE_PATTERN.test(String(payload.host_company_code))) {
                errors.push('host_company_code tem que ter 2 dígitos.');
            }
            if (!EMPLOYEE_ID_PATTERN.test(String(payload.host_employee_id))) {
                errors.push('host_employee_id tem no máximo 6 caracteres.');
            }
            if (!SITE_CODE_PATTERN.test(String(payload.host_branch_code))) {
                errors.push('host_branch_code tem que ter 4 dígitos.');
            }
        }
        return errors;
    }

    const missing = parts.filter(field => isBlank(payload[field]));
    errors.push(
        `Convidante incompleto: falta ${missing.join(', ')}. ` +
        'Informe as três colunas host_* ou nenhuma.'
    );
    return errors;
}

/**
 * Um grupo com `requires_host` ligado só pode ser servido depois do QR de quem
 * convidou — é assim que a refeição do visitante cai no centro de custo do
 * comprador em vez de virar custo sem dono.
 *
 * @param {{requires_host: (boolean|number)}} group
 * @param {object} payload
 * @returns {string[]}
 */
function validateGroupRequiresHost(group, payload = {}) {
    if (!group) return ['Grupo não encontrado ou inativo.'];
    if (!group.requires_host) return [];

    if (isBlank(payload.host_employee_id)) {
        return [
            `O grupo "${group.label}" exige o QR de quem convidou antes de servir. ` +
            'Passe o crachá do anfitrião e tente de novo.'
        ];
    }
    return [];
}

module.exports = {
    validateMealLog,
    validateGroupRequiresHost,
    SITE_CODE_PATTERN,
    COMPANY_CODE_PATTERN,
    EMPLOYEE_ID_PATTERN,
};
