/**
 * @fileoverview Controller de Gestão de Acessos.
 *
 * Camada de entrada HTTP para gerenciamento de usuários, papéis (roles),
 * permissões e acessos a aplicações. Cada função delega ao `AccessService`
 * e retorna a resposta adequada.
 *
 * @module modules/global/controllers/access.controller
 */

const { AccessService } = require('../services/access.service');
const { respond }       = require('../../../utils/respond');

// ─── Usuários ──────────────────────────────────────────────────────────────────

/**
 * Lista usuários com filtros opcionais via query string.
 *
 * Query params: `ad_status` (pending|active|blocked|delete), `name`, `registration`, `branch_code`.
 *
 * @route GET /access/users
 * @param {import('express').Request}  req - Requisição Express.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a lista de usuários.
 */
async function getUsers(req, res) {
    const q       = req.query;
    const filters = {};

    if (q.ad_status   !== undefined) filters.ad_status   = q.ad_status;
    if (q.name        !== undefined) filters.name        = q.name;
    if (q.registration!== undefined) filters.registration= q.registration;
    if (q.branch_code !== undefined) filters.branch_code = q.branch_code;

    const service = new AccessService();
    const data    = await service.getUsers(filters);
    return respond.ok(res, data);
}

/**
 * Retorna um usuário pelo ID, com seus papéis e permissões expandidos.
 *
 * @route GET /access/users/:id
 * @param {import('express').Request}  req - Requisição com `params.id`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com o usuário.
 */
async function getUserById(req, res) {
    const service = new AccessService();
    const data    = await service.getUserById(Number(req.params.id));
    return respond.ok(res, data);
}

/**
 * Cria um novo usuário.
 *
 * O campo `created_by` é preenchido automaticamente com o ID do usuário autenticado.
 *
 * @route POST /access/users
 * @param {import('express').Request}  req - Requisição com `user` e `body`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `201 Created` com o usuário criado.
 */
async function postUser(req, res) {
    const service = new AccessService();
    const data    = await service.createUser(req.body, req.user.id);
    return respond.created(res, data);
}

/**
 * Atualiza completamente um usuário (PUT).
 *
 * @route PUT /access/users/:id
 * @param {import('express').Request}  req - Requisição com `params.id`, `user` e `body`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com o usuário atualizado.
 */
async function putUser(req, res) {
    const service = new AccessService();
    const data    = await service.updateUser(
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
 *
 * @route PATCH /access/users/:id
 * @param {import('express').Request}  req - Requisição com `params.id`, `user` e `body`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com o usuário após atualização.
 */
async function patchUser(req, res) {
    const service = new AccessService();
    const data    = await service.patchUser(
        Number(req.params.id),
        req.body,
        req.user.id
    );
    return respond.ok(res, data);
}

/**
 * Desativa um usuário (soft-delete: `ad_status = 'delete'`).
 *
 * @route DELETE /access/users/:id
 * @param {import('express').Request}  req - Requisição com `params.id` e `user`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com `{ deactivated: true }`.
 */
async function deleteUser(req, res) {
    const service = new AccessService();
    const data    = await service.deactivateUser(Number(req.params.id), req.user.id);
    return respond.ok(res, data);
}

// ─── Papéis (Roles) ────────────────────────────────────────────────────────────

/**
 * Lista todos os papéis com suas permissões agregadas.
 *
 * @route GET /access/roles
 * @param {import('express').Request}  req - Requisição Express.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a lista de papéis.
 */
async function getRoles(req, res) {
    const service = new AccessService();
    const data    = await service.getRoles();
    return respond.ok(res, data);
}

/**
 * Retorna um papel pelo ID com suas permissões.
 *
 * @route GET /access/roles/:id
 * @param {import('express').Request}  req - Requisição com `params.id`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com o papel.
 */
async function getRoleById(req, res) {
    const service = new AccessService();
    const data    = await service.getRoleById(Number(req.params.id));
    return respond.ok(res, data);
}

/**
 * Cria um novo papel.
 *
 * @route POST /access/roles
 * @param {import('express').Request}  req - Requisição com `body.name` e `body.description`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `201 Created` com o papel criado.
 */
async function postRole(req, res) {
    const service = new AccessService();
    const data    = await service.createRole(req.body);
    return respond.created(res, data);
}

/**
 * Atualiza nome e descrição de um papel (PUT).
 *
 * @route PUT /access/roles/:id
 * @param {import('express').Request}  req - Requisição com `params.id` e `body`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com o papel atualizado.
 */
async function putRole(req, res) {
    const service = new AccessService();
    const data    = await service.updateRole({ ...req.body, id: Number(req.params.id) });
    return respond.ok(res, data);
}

/**
 * Remove um papel (somente se não houver usuários vinculados).
 *
 * @route DELETE /access/roles/:id
 * @param {import('express').Request}  req - Requisição com `params.id`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com `{ deleted: true }`.
 */
async function deleteRole(req, res) {
    const service = new AccessService();
    const data    = await service.deleteRole(Number(req.params.id));
    return respond.ok(res, data);
}

// ─── Permissões ────────────────────────────────────────────────────────────────

/**
 * Lista todas as permissões cadastradas.
 *
 * @route GET /access/permissions
 * @param {import('express').Request}  req - Requisição Express.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a lista de permissões.
 */
async function getPermissions(req, res) {
    const service = new AccessService();
    const data    = await service.getPermissions();
    return respond.ok(res, data);
}

/**
 * Cria uma nova permissão.
 *
 * @route POST /access/permissions
 * @param {import('express').Request}  req - Requisição com `body.code` e `body.description`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `201 Created` com a permissão criada.
 */
async function postPermission(req, res) {
    const service = new AccessService();
    const data    = await service.createPermission(req.body);
    return respond.created(res, data);
}

/**
 * Atualiza código e descrição de uma permissão (PUT).
 *
 * @route PUT /access/permissions/:id
 * @param {import('express').Request}  req - Requisição com `params.id` e `body`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a permissão atualizada.
 */
async function putPermission(req, res) {
    const service = new AccessService();
    const data    = await service.updatePermission({ ...req.body, id: Number(req.params.id) });
    return respond.ok(res, data);
}

/**
 * Remove uma permissão (somente se não estiver associada a nenhum papel).
 *
 * @route DELETE /access/permissions/:id
 * @param {import('express').Request}  req - Requisição com `params.id`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com `{ deleted: true }`.
 */
async function deletePermission(req, res) {
    const service = new AccessService();
    const data    = await service.deletePermission(Number(req.params.id));
    return respond.ok(res, data);
}

// ─── Vínculos Usuário ↔ Papel ──────────────────────────────────────────────────

/**
 * Retorna os papéis de um usuário.
 *
 * @route GET /access/users/:id/roles
 * @param {import('express').Request}  req - Requisição com `params.id`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a lista de papéis do usuário.
 */
async function getUserRoles(req, res) {
    const service = new AccessService();
    const data    = await service.getUserRoles(Number(req.params.id));
    return respond.ok(res, data);
}

/**
 * Associa um ou mais papéis a um usuário.
 *
 * @route POST /access/users/:id/roles
 * @param {import('express').Request}  req - Requisição com `params.id` e `body.role_ids`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a lista atualizada de papéis.
 */
async function assignRolesToUser(req, res) {
    const service = new AccessService();
    const data    = await service.assignRolesToUser(
        Number(req.params.id),
        req.body.role_ids
    );
    return respond.ok(res, data);
}

/**
 * Desassocia um papel de um usuário.
 *
 * @route DELETE /access/users/:id/roles/:roleId
 * @param {import('express').Request}  req - Requisição com `params.id` e `params.roleId`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com `{ removed: true }`.
 */
async function removeRoleFromUser(req, res) {
    const service = new AccessService();
    const data    = await service.removeRoleFromUser(
        Number(req.params.id),
        Number(req.params.roleId)
    );
    return respond.ok(res, data);
}

// ─── Vínculos Papel ↔ Permissão ────────────────────────────────────────────────

/**
 * Retorna as permissões de um papel.
 *
 * @route GET /access/roles/:id/permissions
 * @param {import('express').Request}  req - Requisição com `params.id`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a lista de permissões do papel.
 */
async function getRolePermissions(req, res) {
    const service = new AccessService();
    const data    = await service.getRolePermissions(Number(req.params.id));
    return respond.ok(res, data);
}

/**
 * Associa uma ou mais permissões a um papel.
 *
 * @route POST /access/roles/:id/permissions
 * @param {import('express').Request}  req - Requisição com `params.id` e `body.permission_ids`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a lista atualizada de permissões.
 */
async function assignPermissionsToRole(req, res) {
    const service = new AccessService();
    const data    = await service.assignPermissionsToRole(
        Number(req.params.id),
        req.body.permission_ids
    );
    return respond.ok(res, data);
}

/**
 * Substitui completamente as permissões de um papel (operação atômica).
 * Remove todas as permissões existentes e insere as novas em uma transação.
 *
 * @route PUT /access/roles/:id/permissions
 * @param {import('express').Request}  req - Requisição com `params.id` e `body.permission_ids`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a lista atualizada de permissões.
 */
async function setRolePermissions(req, res) {
    const service = new AccessService();
    const data    = await service.setRolePermissions(
        Number(req.params.id),
        req.body.permission_ids
    );
    return respond.ok(res, data);
}

/**
 * Desassocia uma permissão de um papel.
 *
 * @route DELETE /access/roles/:id/permissions/:permissionId
 * @param {import('express').Request}  req - Requisição com `params.id` e `params.permissionId`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com `{ removed: true }`.
 */
async function removePermissionFromRole(req, res) {
    const service = new AccessService();
    const data    = await service.removePermissionFromRole(
        Number(req.params.id),
        Number(req.params.permissionId)
    );
    return respond.ok(res, data);
}

// ─── Aplicações ────────────────────────────────────────────────────────────────

/**
 * Lista todas as aplicações cadastradas.
 *
 * @route GET /access/applications
 * @param {import('express').Request}  req - Requisição Express.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a lista de aplicações.
 */
async function getApplications(req, res) {
    const service = new AccessService();
    const data    = await service.getApplications();
    return respond.ok(res, data);
}

/**
 * Retorna as aplicações às quais o usuário tem acesso.
 *
 * @route GET /access/users/:id/applications
 * @param {import('express').Request}  req - Requisição com `params.id`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a lista de aplicações do usuário.
 */
async function getUserApplications(req, res) {
    const service = new AccessService();
    const data    = await service.getUserApplications(Number(req.params.id));
    return respond.ok(res, data);
}

/**
 * Concede acesso de um usuário a uma aplicação.
 *
 * @route POST /access/users/:id/applications
 * @param {import('express').Request}  req - Requisição com `params.id` e `body.application_id`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a lista atualizada de aplicações.
 */
async function grantApplicationAccess(req, res) {
    const service = new AccessService();
    const data    = await service.grantApplicationAccess(
        Number(req.params.id),
        req.body.application_id
    );
    return respond.ok(res, data);
}

/**
 * Revoga o acesso de um usuário a uma aplicação.
 *
 * @route DELETE /access/users/:id/applications/:appId
 * @param {import('express').Request}  req - Requisição com `params.id` e `params.appId`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com `{ revoked: true }`.
 */
async function revokeApplicationAccess(req, res) {
    const service = new AccessService();
    const data    = await service.revokeApplicationAccess(
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
