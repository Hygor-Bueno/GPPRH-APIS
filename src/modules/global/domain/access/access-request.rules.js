/**
 * @fileoverview Regras do registro de alterações da Gestão de Acessos. Puro.
 *
 * Desde 28/10/2026 toda escrita em `/access/*` vale na hora e deixa uma linha
 * em `_access_requests` com a foto do que havia antes (`previous_state`):
 *
 * | Quem altera        | Registro                                          |
 * |--------------------|---------------------------------------------------|
 * | `SYSTEM_OWNER`     | `approved` na hora — não há a quem prestar contas |
 * | `ACCESS_MANAGE`    | `pending` até alguém com `ACCESS_APPROVE` revisar |
 *
 * Revisar: aprovar só fecha o registro; recusar DESFAZ a alteração a partir
 * da foto (ver `access-request.use-cases.js#_revert`).
 *
 * Travas que valem antes de qualquer registro:
 * - `SYSTEM_OWNER` não aparece nem é atribuído pela API — só pelo banco. Um
 *   papel que tem `SYSTEM_OWNER` é intocável por aqui, até para os donos.
 * - Ninguém além dos donos altera o próprio cadastro, nem as permissões de um
 *   papel que tem.
 * - Só dono dá ou tira `ACCESS_APPROVE` (a permissão, ou papel que a tem).
 *   Senão quem tem `ACCESS_MANAGE` faria um colega revisor e os dois
 *   aprovariam as alterações um do outro.
 * - A conta de um dono só é alterada por outro dono.
 *
 * @module modules/global/domain/access/access-request.rules
 */

const { AppError } = require('../../../../errors/app.error');
const { AccessRequestStatus, AccessErrorCode } = require('./access-request.enums');

/** A mesma permissão do bypass do `canAny`. */
const OWNER_PERMISSION = 'SYSTEM_OWNER';

/** Quem revisa as alterações de quem tem `ACCESS_MANAGE`. */
const REVIEW_PERMISSION = 'ACCESS_APPROVE';

/** @param {{permissions?: string|string[]}} user - `getUserById` traz CSV. */
function permissionsOf(user) {
    return Array.isArray(user?.permissions)
        ? user.permissions
        : String(user?.permissions || '').split(',');
}

/** @param {{permissions?: string|string[]}} user @returns {boolean} */
function isOwner(user) {
    return permissionsOf(user).includes(OWNER_PERMISSION);
}

/** @param {{permissions?: string|string[]}} user @returns {boolean} */
function isReviewer(user) {
    return isOwner(user) || permissionsOf(user).includes(REVIEW_PERMISSION);
}

/**
 * Pode alterar este usuário?
 * - a conta de um dono só outro dono altera — senão quem tem `ACCESS_MANAGE`
 *   resetaria a senha de um dono e entraria como ele;
 * - o próprio cadastro só o dono altera.
 *
 * @param {{id: number, permissions?: string|string[]}} target
 * @param {{id: number, permissions?: string[]}} actor
 * @throws {AppError} 403
 */
function assertCanManageUser(target, actor) {
    if (isOwner(actor)) return;
    if (isOwner(target)) {
        throw new AppError('Só um dono do sistema pode alterar a conta de outro dono do sistema.', 403, {
            code: AccessErrorCode.TargetIsOwner,
        });
    }
    if (Number(target.id) === Number(actor.id)) {
        throw new AppError('Você não pode alterar o próprio cadastro.', 403, { code: AccessErrorCode.SelfEdit });
    }
}

/**
 * Mudar as permissões de um papel que a pessoa tem é mudar o próprio acesso.
 *
 * @param {number} roleId
 * @param {number[]} actorRoleIds
 * @param {{permissions?: string[]}} actor
 * @throws {AppError} 403
 */
function assertNotOwnRole(roleId, actorRoleIds, actor) {
    if (isOwner(actor)) return;
    if (actorRoleIds.map(Number).includes(Number(roleId))) {
        throw new AppError('Você não pode alterar um papel que você tem.', 403, { code: AccessErrorCode.SelfEdit });
    }
}

/**
 * Papel com `SYSTEM_OWNER` não é dado, tirado nem editado pela API — vale
 * para todos, donos inclusive.
 *
 * @param {number[]} roleIds
 * @param {number[]} protectedRoleIds
 * @throws {AppError} 403
 */
function assertRolesNotProtected(roleIds, protectedRoleIds) {
    const blocked = roleIds.filter(id => protectedRoleIds.includes(Number(id)));
    if (blocked.length) {
        throw new AppError('Papel de dono do sistema só pode ser alterado direto no banco.', 403, {
            code: AccessErrorCode.OwnerProtected,
        });
    }
}

/**
 * A permissão `SYSTEM_OWNER` não entra em papel, não é renomeada nem
 * excluída pela API.
 *
 * @param {number[]} permissionIds
 * @param {?number} ownerPermissionId
 * @throws {AppError} 403
 */
function assertNoOwnerPermission(permissionIds, ownerPermissionId) {
    if (ownerPermissionId && permissionIds.map(Number).includes(Number(ownerPermissionId))) {
        throw new AppError('A permissão de dono do sistema só pode ser atribuída direto no banco.', 403, {
            code: AccessErrorCode.OwnerProtected,
        });
    }
}

/**
 * Quem revisa é escolhido pelos donos: fora eles, ninguém dá, tira nem edita
 * papel que tem `ACCESS_APPROVE`.
 *
 * @param {number[]} roleIds
 * @param {number[]} reviewerRoleIds
 * @param {{permissions?: string[]}} actor
 * @throws {AppError} 403
 */
function assertRolesNotReviewer(roleIds, reviewerRoleIds, actor) {
    if (isOwner(actor)) return;
    if (roleIds.some(id => reviewerRoleIds.includes(Number(id)))) {
        throw new AppError('Só um dono do sistema dá, tira ou altera papel de revisor de acessos.', 403, {
            code: AccessErrorCode.ReviewerProtected,
        });
    }
}

/**
 * Idem para a permissão: fora os donos, ninguém põe `ACCESS_APPROVE` num
 * papel, nem a renomeia ou exclui.
 *
 * @param {number[]} permissionIds
 * @param {?number} reviewPermissionId
 * @param {{permissions?: string[]}} actor
 * @throws {AppError} 403
 */
function assertNoReviewPermission(permissionIds, reviewPermissionId, actor) {
    if (isOwner(actor)) return;
    if (reviewPermissionId && permissionIds.map(Number).includes(Number(reviewPermissionId))) {
        throw new AppError('Só um dono do sistema dá, tira ou altera a permissão de revisor de acessos.', 403, {
            code: AccessErrorCode.ReviewerProtected,
        });
    }
}

/**
 * Lista de ids vinda do body (`role_ids`, `permission_ids`): inteiros
 * positivos, sem repetição. Vai gravada no registro, então lixo é recusado aqui.
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
 * Revisar: o registro precisa estar pendente, quem revisa não pode ser quem
 * alterou, nem (fora os donos) a pessoa alterada.
 *
 * @param {{status: string, requested_by: number, target_user_id: ?number}} request
 * @param {{id: number, permissions?: string[]}} reviewer
 * @throws {AppError} 409 / 403
 */
function assertReviewable(request, reviewer) {
    if (request.status !== AccessRequestStatus.PENDING) {
        throw new AppError('Esta alteração já foi revisada.', 409, { code: AccessErrorCode.RequestNotPending });
    }
    if (Number(request.requested_by) === Number(reviewer.id)) {
        throw new AppError('Você não pode revisar a própria alteração.', 403, { code: AccessErrorCode.SelfReview });
    }
    if (!isOwner(reviewer) && Number(request.target_user_id) === Number(reviewer.id)) {
        throw new AppError('Você não pode revisar uma alteração no seu próprio cadastro.', 403, {
            code: AccessErrorCode.SelfTarget,
        });
    }
}

/**
 * Desfazer um vínculo em lista (papéis, aplicações, permissões) sem pisar no
 * que outra pessoa mudou depois: tira só o que a alteração acrescentou e põe
 * de volta só o que ela tirou.
 *
 * @param {number[]} before - como estava antes da alteração
 * @param {number[]} after  - como a alteração deixou
 * @returns {{remove: number[], add: number[]}}
 */
function listRevert(before, after) {
    const was = new Set(before.map(Number));
    const is = new Set(after.map(Number));
    return {
        remove: [...is].filter(id => !was.has(id)),
        add: [...was].filter(id => !is.has(id)),
    };
}

/**
 * Desfazer campos (nome, filial, código…): só volta o campo que ainda está
 * como a alteração deixou. Se alguém mudou de novo depois, fica como está e
 * entra em `skipped`.
 *
 * @param {object} before  - valores antes da alteração
 * @param {object} applied - valores que a alteração gravou
 * @param {object} current - valores agora
 * @returns {{restore: object, skipped: string[]}}
 */
function fieldRevert(before, applied, current) {
    const restore = {};
    const skipped = [];
    for (const key of Object.keys(before)) {
        if (sameValue(current[key], applied[key])) restore[key] = before[key];
        else skipped.push(key);
    }
    return { restore, skipped };
}

/** `0` × `'0'`, `null` × `undefined`: o banco e o body não falam o mesmo tipo. */
function sameValue(a, b) {
    return String(a ?? '') === String(b ?? '');
}

/**
 * Linha do banco → resposta. O `payload` de criação/edição de usuário pode
 * levar o hash da senha: ele nunca sai da API.
 *
 * @param {object} row
 * @returns {object}
 */
function toPublicRequest(row) {
    const { password, ...safePayload } = parseJson(row.payload) || {};
    return {
        ...row,
        payload: safePayload,
        previous_state: parseJson(row.previous_state),
        revert_result: parseJson(row.revert_result),
        sets_password: password !== undefined,
    };
}

/** JSON do MySQL vem objeto (MySQL 8) ou texto (MariaDB). */
function parseJson(value) {
    return typeof value === 'string' ? JSON.parse(value) : (value ?? null);
}

module.exports = {
    OWNER_PERMISSION,
    REVIEW_PERMISSION,
    isOwner,
    isReviewer,
    assertCanManageUser,
    assertNotOwnRole,
    assertRolesNotProtected,
    assertNoOwnerPermission,
    assertRolesNotReviewer,
    assertNoReviewPermission,
    normalizeIds,
    assertReviewable,
    listRevert,
    fieldRevert,
    toPublicRequest,
    parseJson,
};
