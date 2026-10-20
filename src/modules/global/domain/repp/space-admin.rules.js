/**
 * @fileoverview Quem administra cada espaço da REPP e quem mexe nisso.
 *
 * | Quem                         | Lista os administradores | Adiciona/remove |
 * |------------------------------|--------------------------|-----------------|
 * | dono do sistema              | de todos os espaços      | sim             |
 * | administrador do espaço      | do próprio espaço        | não             |
 * | demais                       | não                      | não             |
 *
 * Só o dono adiciona e remove: quem administra um espaço vê detalhes de
 * reserva e fica isento das regras de agenda, e deixar o próprio
 * administrador conceder isso a outros tiraria o controle de quem cuida dos
 * acessos (decisão do Hygor, 16/10/2026).
 *
 * O espaço nunca fica sem administrador ATIVO: sem ele, pedido pendente não
 * avisa ninguém (o dono não recebe `requested`) e fica parado na fila.
 *
 * @module modules/global/domain/repp/space-admin.rules
 */

const { AppError } = require('../../../../errors/app.error');
const { ReppErrorCode } = require('./repp.enums');

const ACTIVE = 'active';

/** Pode adicionar e remover administradores de espaço? */
function canManageAdmins(viewer) {
    return viewer.isOwner;
}

/** Usuário que vai virar administrador: existe e está ativo. */
function assertAdminCandidate(user) {
    if (!user) throw new AppError('Usuário não encontrado.', 404, { code: ReppErrorCode.UserNotFound });
    if (user.ad_status !== ACTIVE) {
        throw new AppError('Só é possível tornar administrador um usuário ativo.', 400, { code: ReppErrorCode.UserInactive });
    }
}

/**
 * Recusa remover quem deixaria o espaço sem nenhum administrador ativo.
 * Remover quem não é administrador não é erro (idempotente).
 *
 * @param {{user_id: number, ad_status: string}[]} admins - os atuais, lidos sob trava.
 * @param {number} userId
 */
function assertAdminRemovable(admins, userId) {
    if (!admins.some((admin) => admin.user_id === userId)) return;
    const remaining = admins.filter((admin) => admin.user_id !== userId && admin.ad_status === ACTIVE);
    if (remaining.length === 0) {
        throw new AppError(
            'O espaço precisa de pelo menos um administrador ativo. Adicione outro administrador antes de remover este.',
            409,
            { code: ReppErrorCode.LastSpaceAdmin },
        );
    }
}

module.exports = { canManageAdmins, assertAdminCandidate, assertAdminRemovable };
