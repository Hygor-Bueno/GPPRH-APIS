/**
 * @fileoverview Controller de Gestão de Acessos.
 *
 * Camada de entrada HTTP para gerenciamento de usuários, papéis (roles),
 * permissões e acessos a aplicações. Cada função delega ao `AccessUseCases`
 * e retorna a resposta adequada.
 *
 * @module modules/global/controllers/access.controller
 */

const { respond } = require('../../../utils/respond');
const { AccessUseCases } = require('../application/access/access.use-cases');
const { MysqlAccessRepository } = require('../infrastructure/access/mysql-access.repository');

const useCases = new AccessUseCases({ repository: new MysqlAccessRepository() });

// ─── Usuários ──────────────────────────────────────────────────────────────────

/**
 * Lista usuários com filtros opcionais via query string.
 *
 * Query params: `ad_status` (pending|active|blocked|delete), `name`, `registration`, `branch_code`.
 *
 * @route GET /access/users
 */
async function getUsers(req, res) {
    const q       = req.query;
    const filters = {};

    if (q.ad_status   !== undefined) filters.ad_status   = q.ad_status;
    if (q.name        !== undefined) filters.name        = q.name;
    if (q.registration!== undefined) filters.registration= q.registration;
    if (q.branch_code !== undefined) filters.branch_code = q.branch_code;

    const data = await useCases.getUsers(filters);
    return respond.ok(res, data);
}

/**
 * Retorna um usuário pelo ID, com seus papéis e permissões expandidos.
 * @route GET /access/users/:id
 */
async function getUserById(req, res) {
    const data = await useCases.getUserById(Number(req.params.id));
    return respond.ok(res, data);
}

/**
 * Cria um novo usuário. O campo `created_by` é preenchido automaticamente
 * com o ID do usuário autenticado.
 * @route POST /access/users
 */
async function postUser(req, res) {
    const data = await useCases.createUser(req.body, req.user.id);
    return respond.created(res, data);
}

/**
 * Atualiza completamente um usuário (PUT).
 * @route PUT /access/users/:id
 */
async function putUser(req, res) {
    const data = await useCases.updateUser(
        { ...req.body, id: Number(req.params.id) },
        req.user.id
    );
    return respond.ok(res, data);
}

/**
 * Atualiza parcialmente um usuário (PATCH).
 *
 * Campos aceitos: `name`, `registration`, `branch_code`, `administrator`,
 * `table_protheus`, `ad_status`, `password`. Campos não reconhecidos são ignorados.
 * @route PATCH /access/users/:id
 */
async function patchUser(req, res) {
    const data = await useCases.patchUser(
        Number(req.params.id),
        req.body,
        req.user.id
    );
    return respond.ok(res, data);
}

/**
 * Desativa um usuário (soft-delete: `ad_status = 'delete'`).
 * @route DELETE /access/users/:id
 */
async function deleteUser(req, res) {
    const data = await useCases.deactivateUser(Number(req.params.id), req.user.id);
    return respond.ok(res, data);
}

// ─── Papéis (Roles) ────────────────────────────────────────────────────────────

/**
 * Lista todos os papéis com suas permissões agregadas.
 * @route GET /access/roles
 */
async function getRoles(req, res) {
    const data = await useCases.getRoles();
    return respond.ok(res, data);
}

/**
 * Retorna um papel pelo ID com suas permissões.
 * @route GET /access/roles/:id
 */
async function getRoleById(req, res) {
    const data = await useCases.getRoleById(Number(req.params.id));
    return respond.ok(res, data);
}

/**
 * Cria um novo papel.
 * @route POST /access/roles
 */
async function postRole(req, res) {
    const data = await useCases.createRole(req.body);
    return respond.created(res, data);
}

/**
 * Atualiza nome e descrição de um papel (PUT).
 * @route PUT /access/roles/:id
 */
async function putRole(req, res) {
    const data = await useCases.updateRole({ ...req.body, id: Number(req.params.id) });
    return respond.ok(res, data);
}

/**
 * Remove um papel (somente se não houver usuários vinculados).
 * @route DELETE /access/roles/:id
 */
async function deleteRole(req, res) {
    const data = await useCases.deleteRole(Number(req.params.id));
    return respond.ok(res, data);
}

// ─── Permissões ────────────────────────────────────────────────────────────────

/**
 * Lista todas as permissões cadastradas.
 * @route GET /access/permissions
 */
async function getPermissions(req, res) {
    const data = await useCases.getPermissions();
    return respond.ok(res, data);
}

/**
 * Cria uma nova permissão.
 * @route POST /access/permissions
 */
async function postPermission(req, res) {
    const data = await useCases.createPermission(req.body);
    return respond.created(res, data);
}

/**
 * Atualiza código e descrição de uma permissão (PUT).
 * @route PUT /access/permissions/:id
 */
async function putPermission(req, res) {
    const data = await useCases.updatePermission({ ...req.body, id: Number(req.params.id) });
    return respond.ok(res, data);
}

/**
 * Remove uma permissão (somente se não estiver associada a nenhum papel).
 * @route DELETE /access/permissions/:id
 */
async function deletePermission(req, res) {
    const data = await useCases.deletePermission(Number(req.params.id));
    return respond.ok(res, data);
}

// ─── Vínculos Usuário ↔ Papel ──────────────────────────────────────────────────

/**
 * Retorna os papéis de um usuário.
 * @route GET /access/users/:id/roles
 */
async function getUserRoles(req, res) {
    const data = await useCases.getUserRoles(Number(req.params.id));
    return respond.ok(res, data);
}

/**
 * Associa um ou mais papéis a um usuário.
 * @route POST /access/users/:id/roles
 */
async function assignRolesToUser(req, res) {
    const data = await useCases.assignRolesToUser(
        Number(req.params.id),
        req.body.role_ids
    );
    return respond.ok(res, data);
}

/**
 * Desassocia um papel de um usuário.
 * @route DELETE /access/users/:id/roles/:roleId
 */
async function removeRoleFromUser(req, res) {
    const data = await useCases.removeRoleFromUser(
        Number(req.params.id),
        Number(req.params.roleId)
    );
    return respond.ok(res, data);
}

// ─── Vínculos Papel ↔ Permissão ────────────────────────────────────────────────

/**
 * Retorna as permissões de um papel.
 * @route GET /access/roles/:id/permissions
 */
async function getRolePermissions(req, res) {
    const data = await useCases.getRolePermissions(Number(req.params.id));
    return respond.ok(res, data);
}

/**
 * Associa uma ou mais permissões a um papel.
 * @route POST /access/roles/:id/permissions
 */
async function assignPermissionsToRole(req, res) {
    const data = await useCases.assignPermissionsToRole(
        Number(req.params.id),
        req.body.permission_ids
    );
    return respond.ok(res, data);
}

/**
 * Substitui completamente as permissões de um papel (operação atômica).
 * @route PUT /access/roles/:id/permissions
 */
async function setRolePermissions(req, res) {
    const data = await useCases.setRolePermissions(
        Number(req.params.id),
        req.body.permission_ids
    );
    return respond.ok(res, data);
}

/**
 * Desassocia uma permissão de um papel.
 * @route DELETE /access/roles/:id/permissions/:permissionId
 */
async function removePermissionFromRole(req, res) {
    const data = await useCases.removePermissionFromRole(
        Number(req.params.id),
        Number(req.params.permissionId)
    );
    return respond.ok(res, data);
}

// ─── Aplicações ────────────────────────────────────────────────────────────────

/**
 * Lista todas as aplicações cadastradas.
 * @route GET /access/applications
 */
async function getApplications(req, res) {
    const data = await useCases.getApplications();
    return respond.ok(res, data);
}

/**
 * Retorna as aplicações às quais o usuário tem acesso.
 * @route GET /access/users/:id/applications
 */
async function getUserApplications(req, res) {
    const data = await useCases.getUserApplications(Number(req.params.id));
    return respond.ok(res, data);
}

/**
 * Concede acesso de um usuário a uma aplicação.
 * @route POST /access/users/:id/applications
 */
async function grantApplicationAccess(req, res) {
    const data = await useCases.grantApplicationAccess(
        Number(req.params.id),
        req.body.application_id
    );
    return respond.ok(res, data);
}

/**
 * Revoga o acesso de um usuário a uma aplicação.
 * @route DELETE /access/users/:id/applications/:appId
 */
async function revokeApplicationAccess(req, res) {
    const data = await useCases.revokeApplicationAccess(
        Number(req.params.id),
        Number(req.params.appId)
    );
    return respond.ok(res, data);
}

module.exports = {
    // Usuários
    getUsers,
    getUserById,
    postUser,
    putUser,
    patchUser,
    deleteUser,
    // Papéis
    getRoles,
    getRoleById,
    postRole,
    putRole,
    deleteRole,
    // Permissões
    getPermissions,
    postPermission,
    putPermission,
    deletePermission,
    // Vínculos usuário ↔ papel
    getUserRoles,
    assignRolesToUser,
    removeRoleFromUser,
    // Vínculos papel ↔ permissão
    getRolePermissions,
    assignPermissionsToRole,
    setRolePermissions,
    removePermissionFromRole,
    // Aplicações
    getApplications,
    getUserApplications,
    grantApplicationAccess,
    revokeApplicationAccess
};
