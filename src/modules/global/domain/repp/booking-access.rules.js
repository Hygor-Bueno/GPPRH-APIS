/**
 * @fileoverview Quem vê o quê e quem pode fazer o quê na REPP.
 *
 * A decisão é POR ESPAÇO (e por reserva, para o criador): quem administra só
 * o Auditório vê os detalhes do Auditório e a versão mascarada da Sala de
 * Treinamento. O front não decide nada disso — recebe as flags prontas.
 *
 * | Quem                                  | Vê detalhes | Edita/cancela | Aprova/recusa |
 * |---------------------------------------|-------------|---------------|---------------|
 * | anônimo                               | não         | não           | não           |
 * | logado comum                          | não         | não           | não           |
 * | criador da reserva                    | a dele      | a dele*       | não           |
 * | administrador do espaço (`re_space_admins`) | do espaço | do espaço* | do espaço     |
 * | dono do sistema (`SYSTEM_OWNER`)      | tudo        | tudo*         | tudo          |
 *
 * (*) só reserva pendente ou aprovada que ainda não começou.
 *
 * O administrador do espaço é uma linha em `re_space_admins`, e não uma
 * permissão de `_permissions`: a permissão é global, e aqui o alcance é um
 * espaço específico. `re_space_admins` é vínculo de alcance, não cadastro de
 * pessoa — a identidade continua sendo `_user`.
 *
 * @module modules/global/domain/repp/booking-access.rules
 */

const { isOccupying, hasStarted } = require('./booking.rules');
const { BookingStatus } = require('./repp.enums');

/**
 * Mesmo código que o `permission.middleware` trata como bypass total. Repetido
 * aqui porque o middleware não o exporta e o domínio não depende de Express.
 */
const SYSTEM_OWNER = 'SYSTEM_OWNER';

/**
 * Identidade de quem consulta, já resolvida.
 *
 * @param {object|null} user - `req.user` (ou `null` para anônimo).
 * @param {number[]} [managedSpaceIds] - espaços em `re_space_admins` para ele.
 * @returns {{userId: ?number, isOwner: boolean, managed: Set<number>, authenticated: boolean}}
 */
function buildViewer(user, managedSpaceIds = []) {
    if (!user?.id) return { userId: null, isOwner: false, managed: new Set(), authenticated: false };
    return {
        userId: Number(user.id),
        isOwner: (user.permissions || []).includes(SYSTEM_OWNER),
        managed: new Set(managedSpaceIds.map(Number)),
        authenticated: true,
    };
}

/** Administra o espaço (ou é dono do sistema)? É quem aprova e quem reserva sem fila. */
function canReviewSpace(viewer, spaceId) {
    return viewer.isOwner || viewer.managed.has(Number(spaceId));
}

/** Administra pelo menos um espaço (ou é dono)? Decide o acesso à fila de aprovação. */
function isAnySpaceAdmin(viewer) {
    return viewer.isOwner || viewer.managed.size > 0;
}

function isCreator(viewer, booking) {
    return viewer.userId !== null && booking.created_by != null && Number(booking.created_by) === viewer.userId;
}

/** Vê nome, empresa, filial, centro de custo, título e criador? */
function canViewDetails(viewer, booking) {
    return canReviewSpace(viewer, booking.space_id) || isCreator(viewer, booking);
}

/** Pode editar e cancelar? Só reserva viva (pendente/aprovada) que não começou. */
function canManage(viewer, booking, now) {
    if (!isOccupying(booking.status) || hasStarted(booking, now)) return false;
    return canReviewSpace(viewer, booking.space_id) || isCreator(viewer, booking);
}

/** Pode aprovar ou recusar? Só pendente que não começou, por quem administra o espaço. */
function canReview(viewer, booking, now) {
    if (booking.status !== BookingStatus.Pending || hasStarted(booking, now)) return false;
    return canReviewSpace(viewer, booking.space_id);
}

/**
 * Escopo das consultas de agenda, para o adapter separar o que pode sair com
 * detalhes do que sai mascarado SEM ler as colunas sensíveis do segundo grupo.
 *
 * @returns {{all: boolean, spaceIds: number[], userId: ?number}}
 *   `all` = dono do sistema (tudo detalhado); senão, detalhado é
 *   `space_id IN spaceIds OR created_by = userId`.
 */
function detailScope(viewer) {
    return {
        all: viewer.isOwner,
        spaceIds: [...viewer.managed],
        userId: viewer.userId,
    };
}

module.exports = {
    SYSTEM_OWNER,
    buildViewer,
    canReviewSpace,
    isAnySpaceAdmin,
    isCreator,
    canViewDetails,
    canManage,
    canReview,
    detailScope,
};
