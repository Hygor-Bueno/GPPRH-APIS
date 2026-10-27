/**
 * @fileoverview Regras da fila de aprovação da Gestão de Acessos. Puro.
 *
 * Quem tem `ACCESS_MANAGE` continua podendo pedir tudo, mas criar usuário e
 * mexer no que dá acesso (papéis, aplicações, permissões de papel, código de
 * permissão, `administrator`, ativação) vira uma linha em `_access_requests`
 * que só vale depois que um dono do sistema (`SYSTEM_OWNER`) aprova.
 *
 * | Quem pede          | O que acontece                                   |
 * |--------------------|--------------------------------------------------|
 * | `SYSTEM_OWNER`     | aplica na hora — não há a quem pedir             |
 * | qualquer outro     | fica `pending` até um `SYSTEM_OWNER` aprovar     |
 *
 * O que só TIRA acesso sem mexer em papel/aplicação (bloquear, desativar)
 * continua valendo na hora: bloquear quem saiu da empresa não pode esperar.
 * Exceção: a conta de um dono só é editada, desativada ou tem a senha trocada
 * por outro dono (`assertCanManageUser`).
 *
 * Por que `PUT /access/permissions/:id` está na fila: renomear o código de uma
 * permissão que a pessoa já tem para o de uma mais forte (depois de renomear a
 * original) é escalada de privilégio sem tocar em vínculo nenhum.
 *
 * @module modules/global/domain/access/access-request.rules
 */

const { AppError } = require('../../../../errors/app.error');
const { AccessRequestStatus, AccessErrorCode } = require('./access-request.enums');

/** A mesma permissão do bypass do `canAny`. */
const APPROVER_PERMISSION = 'SYSTEM_OWNER';

/** @param {{permissions?: string[]}} user @returns {boolean} */
function isApprover(user) {
    return (user?.permissions || []).includes(APPROVER_PERMISSION);
}

/**
 * Conta de dono do sistema só é mexida por outro dono: trocar senha, resetar,
 * editar ou desativar. Sem isso, quem tem `ACCESS_MANAGE` resetaria a senha de
 * um dono, entraria como ele e aprovaria os próprios pedidos.
 *
 * @param {{permissions?: string|string[]}} target - `getUserById` traz CSV.
 * @param {{permissions?: string[]}} actor
 * @throws {AppError} 403
 */
function assertCanManageUser(target, actor) {
    const targetPermissions = Array.isArray(target?.permissions)
        ? target.permissions
        : String(target?.permissions || '').split(',');
    if (targetPermissions.includes(APPROVER_PERMISSION) && !isApprover(actor)) {
        throw new AppError('Só um dono do sistema pode alterar a conta de outro dono do sistema.', 403, {
            code: AccessErrorCode.TargetIsOwner,
        });
    }
}

/**
 * Diz se uma edição de usuário (PUT/PATCH) concede acesso e, portanto, vai
 * para a fila. Só compara o que veio em `changes`.
 *
 * - `administrator`: qualquer mudança.
 * - `ad_status`: só a que passa a ser `active` — bloquear vale na hora.
 *
 * @param {{administrator?: number, ad_status?: string}} current - usuário como está.
 * @param {object} changes
 * @returns {boolean}
 */
function userChangeGrantsAccess(current, changes) {
    if ('administrator' in changes
        && Number(changes.administrator) !== Number(current.administrator)) {
        return true;
    }
    if ('ad_status' in changes
        && changes.ad_status === 'active'
        && current.ad_status !== 'active') {
        return true;
    }
    return false;
}

/**
 * Lista de ids vinda do body (`role_ids`, `permission_ids`): inteiros
 * positivos, sem repetição. Vai gravada no pedido, então lixo é recusado aqui.
 *
 * @param {*} list
 * @param {{allowEmpty?: boolean}} [options] - `PUT .../permissions` aceita
 *   lista vazia (tirar todas).
 * @returns {number[]}
 * @throws {AppError} 400
 */
function normalizeIds(list, { allowEmpty = false } = {}) {
    if (!Array.isArray(list)) {
        throw new AppError('Informe uma lista de ids.', 400, { code: AccessErrorCode.InvalidIds });
    }
    const ids = list.map(Number);
    if (ids.some(id => !Number.isInteger(id) || id <= 0)) {
        throw new AppError('Os ids devem ser inteiros positivos.', 400, { code: AccessErrorCode.InvalidIds });
    }
    if (!ids.length && !allowEmpty) {
        throw new AppError('Informe ao menos um id.', 400, { code: AccessErrorCode.InvalidIds });
    }
    return [...new Set(ids)];
}

/**
 * Aprovar ou recusar: o pedido precisa estar pendente e quem revisa não pode
 * ser quem pediu.
 *
 * @param {{status: string, requested_by: number}} request
 * @param {{id: number}} reviewer
 * @throws {AppError} 409 / 403
 */
function assertReviewable(request, reviewer) {
    if (request.status !== AccessRequestStatus.PENDING) {
        throw new AppError('Este pedido já foi analisado.', 409, { code: AccessErrorCode.RequestNotPending });
    }
    if (Number(request.requested_by) === Number(reviewer.id)) {
        throw new AppError('Você não pode analisar o próprio pedido.', 403, { code: AccessErrorCode.SelfReview });
    }
}

/**
 * Cancelar: só quem pediu, e só enquanto pendente.
 *
 * @param {{status: string, requested_by: number}} request
 * @param {{id: number}} actor
 * @throws {AppError} 409 / 403
 */
function assertCancelable(request, actor) {
    if (request.status !== AccessRequestStatus.PENDING) {
        throw new AppError('Este pedido já foi analisado.', 409, { code: AccessErrorCode.RequestNotPending });
    }
    if (Number(request.requested_by) !== Number(actor.id)) {
        throw new AppError('Só quem fez o pedido pode cancelá-lo.', 403, { code: AccessErrorCode.NotRequester });
    }
}

/**
 * Linha do banco → resposta. O `payload` de criação/edição de usuário pode
 * levar o hash da senha: ele nunca sai da API.
 *
 * @param {object} row
 * @returns {object}
 */
function toPublicRequest(row) {
    let payload = row.payload;
    if (typeof payload === 'string') payload = JSON.parse(payload);
    const { password, ...safePayload } = payload || {};
    return {
        ...row,
        payload: safePayload,
        sets_password: password !== undefined,
    };
}

module.exports = {
    APPROVER_PERMISSION,
    isApprover,
    assertCanManageUser,
    userChangeGrantsAccess,
    normalizeIds,
    assertReviewable,
    assertCancelable,
    toPublicRequest,
};
