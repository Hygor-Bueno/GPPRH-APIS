/**
 * @fileoverview Guard puro de dono/admin — substitui as duplicações
 * `assertCreatorOrAdmin`/`assertItemOrTaskOwnerOrAdmin` hoje espalhadas em
 * 3 controllers.
 *
 * @module modules/global/domain/gtpp/task/task-ownership.guard
 */

const { AppError } = require('../../../../../errors/app.error');

const DEFAULT_ADMIN_PERMISSIONS = ['MANAGE_GTPP', 'SYSTEM_OWNER'];

/**
 * @param {object} params
 * @param {number} params.currentUserId
 * @param {number[]} params.ownerIds - 1 elemento (dono único) ou mais (ex.: item + tarefa).
 * @param {string[]} [params.permissions]
 * @param {string[]} [params.adminPermissions]
 * @throws {AppError} 403 se não for nem dono nem admin.
 */
function assertAnyOwnerOrAdmin({ currentUserId, ownerIds, permissions = [], adminPermissions = DEFAULT_ADMIN_PERMISSIONS }) {
    const isOwner = ownerIds.includes(currentUserId);
    const isAdmin = permissions.some(p => adminPermissions.includes(p));

    if (!isOwner && !isAdmin) {
        throw new AppError('Apenas o dono, o criador da tarefa ou um administrador pode realizar esta ação.', 403);
    }
}

module.exports = { assertAnyOwnerOrAdmin, DEFAULT_ADMIN_PERMISSIONS };
