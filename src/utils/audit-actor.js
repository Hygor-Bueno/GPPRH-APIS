/**
 * @fileoverview Responsável pela ação, para trilha de auditoria.
 *
 * Converte o `req.user` da sessão no formato que a camada de banco carimba no
 * `SESSION_CONTEXT` do SQL Server. Existe para que nenhum controller monte esse
 * objeto à mão — o histórico de status é trilha financeira, e um campo montado
 * de forma diferente em cada rota é exatamente como uma auditoria deixa de
 * fechar.
 *
 * ⚠️ A fonte é SEMPRE o `req.user`, que vem do cookie HttpOnly e foi carimbado
 * no login por `login-payload.mapper.js` a partir de `sp_get_user_authorization`
 * (banco global) + Protheus. Nunca aceite matrícula, filial ou nome vindos do
 * corpo da requisição: seriam dados livres do cliente decidindo quem assina uma
 * transição de pagamento.
 *
 * Matrícula e filial permanecem STRING, com zeros à esquerda. No banco global
 * elas já vêm nesse formato (`_user.registration` = 6 caracteres,
 * `_user.branch_code` = 4), mas o `padStart` fica como rede: uma linha que
 * chegasse como `2351` gravaria `002351` em vez de virar número e perder o
 * zero — `branch_code_snapshot` é VARCHAR(4), não INT.
 *
 * @module utils/audit-actor
 */

/** Tamanho de `registration_snapshot` / `changed_by_registration_snapshot`. */
const REGISTRATION_LENGTH = 6;

/** Tamanho de `branch_code_snapshot` / `changed_by_branch_snapshot`. */
const BRANCH_CODE_LENGTH = 4;

/**
 * Normaliza um código organizacional preservando os zeros à esquerda.
 *
 * Devolve `null` para ausência (e não string vazia): a coluna aceita NULL, e
 * `''` gravaria uma matrícula em branco que passa por preenchida nas consultas
 * de conferência.
 *
 * @param {string|number|null|undefined} value
 * @param {number} length
 * @returns {string|null}
 */
function padCode(value, length) {
    if (value === null || value === undefined) return null;

    const text = String(value).trim();
    if (!text) return null;

    // Mais longo que o esperado não é truncado: truncar inventaria um código
    // que existe e aponta para outra pessoa. Passa como está e o banco recusa.
    return text.length >= length ? text : text.padStart(length, '0');
}

/**
 * Responsável de processo automático — sem usuário.
 *
 * Congelado de propósito: é compartilhado entre chamadas, e uma rotina que
 * mutasse este objeto contaminaria a auditoria de todas as outras. Quem usa
 * este ator é obrigado a informar uma `change_source` específica
 * (`CALCULATION_JOB`, `PAYMENT_JOB`, ...) — usuário nulo é aceitável, origem
 * genérica não.
 */
const SYSTEM_ACTOR = Object.freeze({
    globalUserId: null,
    name: null,
    registration: null,
    branchCode: null,
});

/**
 * @typedef {object} AuditActor
 * @property {number|null} globalUserId - `_user.id` do banco global.
 * @property {string|null} name         - Nome completo do usuário.
 * @property {string|null} registration - Matrícula, string com zeros à esquerda.
 * @property {string|null} branchCode    - Código da filial, string com zeros à esquerda.
 */

/**
 * Monta o responsável a partir do usuário autenticado.
 *
 * @param {object|null|undefined} user - `req.user`.
 * @returns {AuditActor}
 */
function toAuditActor(user) {
    if (!user) return SYSTEM_ACTOR;

    const id = Number(user.id);

    return {
        globalUserId: Number.isInteger(id) ? id : null,
        name: user.name ? String(user.name).trim() : null,
        registration: padCode(user.registration, REGISTRATION_LENGTH),
        branchCode: padCode(user.branch_code, BRANCH_CODE_LENGTH),
    };
}

module.exports = {
    toAuditActor,
    padCode,
    SYSTEM_ACTOR,
    REGISTRATION_LENGTH,
    BRANCH_CODE_LENGTH,
};
