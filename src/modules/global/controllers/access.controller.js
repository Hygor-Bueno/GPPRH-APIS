/**
 * @fileoverview Controller de Gestão de Acessos.
 *
 * Camada de entrada HTTP para gerenciamento de usuários, papéis (roles),
 * permissões e acessos a aplicações. Leitura vai direto ao `AccessUseCases`;
 * toda escrita passa pelo `AccessRequestUseCases`, que grava o registro da
 * alteração (revisado depois por quem tem `ACCESS_APPROVE`).
 *
 * @module modules/global/controllers/access.controller
 */

const { respond } = require('../../../utils/respond');
const { AccessUseCases } = require('../application/access/access.use-cases');
const { MysqlAccessRepository } = require('../infrastructure/access/mysql-access.repository');
const { AccessRequestUseCases } = require('../application/access/access-request.use-cases');
const { MysqlAccessRequestRepository } = require('../infrastructure/access/mysql-access-request.repository');
const { HttpAccessRequestEventPublisher } = require('../infrastructure/access/http-access-request-event.publisher');

const useCases = new AccessUseCases({ repository: new MysqlAccessRepository() });
const requests = new AccessRequestUseCases({
    repository: new MysqlAccessRequestRepository(),
    accessUseCases: useCases,
    eventPublisher: new HttpAccessRequestEventPublisher(),
});

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
    const data = await requests.createUser(req.body, req.user);
    return respond.created(res, data);
}

/**
 * Atualiza completamente um usuário (PUT).
 * @route PUT /access/users/:id
 */
async function putUser(req, res) {
    const data = await requests.updateUser(
        { ...req.body, id: Number(req.params.id) },
        req.user
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
    const data = await requests.patchUser(
        Number(req.params.id),
        req.body,
        req.user
    );
    return respond.ok(res, data);
}

/**
 * Desativa um usuário (soft-delete: `ad_status = 'delete'`).
 * @route DELETE /access/users/:id
 */
async function deleteUser(req, res) {
    const data = await requests.deactivateUser(Number(req.params.id), req.user);
    return respond.ok(res, data);
}

/**
 * Middleware: conta de dono do sistema só é mexida por outro dono, e o próprio
 * cadastro só pelo dono. Usado na rota de reset de senha, que mora no
 * `auth.controller` — as demais rotas de usuário fazem a mesma checagem dentro
 * do `AccessRequestUseCases`.
 */
async function guardOwnerAccount(req, res, next) {
    const id = Number(req.params.id);
    // id inválido segue adiante: quem responde o 400 é o próprio controller da rota.
    if (!Number.isInteger(id) || id <= 0) return next();
    try {
        await requests.assertCanManageUserById(id, req.user);
        return next();
    } catch (error) {
        return next(error);
    }
}

/**
 * Middleware: registra o reset de senha quando o `auth.controller` responde
 * com sucesso. O registro não guarda a senha temporária.
 */
function recordPasswordReset(req, res, next) {
    const id = Number(req.params.id);
    res.on('finish', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return;
        requests.recordPasswordReset(id, req.user).catch(error => {
            console.error(`[access:request] Falha ao registrar o reset de senha do usuário ${id}:`, error.message);
        });
    });
    return next();
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
    const data = await requests.createRole(req.body, req.user);
    return respond.created(res, data);
}

/**
 * Atualiza nome e descrição de um papel (PUT).
 * @route PUT /access/roles/:id
 */
async function putRole(req, res) {
    const data = await requests.updateRole({ ...req.body, id: Number(req.params.id) }, req.user);
    return respond.ok(res, data);
}

/**
 * Remove um papel (somente se não houver usuários vinculados).
 * @route DELETE /access/roles/:id
 */
async function deleteRole(req, res) {
    const data = await requests.deleteRole(Number(req.params.id), req.user);
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
    const data = await requests.createPermission(req.body, req.user);
    return respond.created(res, data);
}

/**
 * Atualiza código e descrição de uma permissão (PUT).
 * @route PUT /access/permissions/:id
 */
async function putPermission(req, res) {
    const data = await requests.updatePermission({ ...req.body, id: Number(req.params.id) }, req.user);
    return respond.ok(res, data);
}

/**
 * Remove uma permissão (somente se não estiver associada a nenhum papel).
 * @route DELETE /access/permissions/:id
 */
async function deletePermission(req, res) {
    const data = await requests.deletePermission(Number(req.params.id), req.user);
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
    const data = await requests.assignRolesToUser(
        Number(req.params.id),
        req.body.role_ids,
        req.user
    );
    return respond.ok(res, data);
}

/**
 * Desassocia um papel de um usuário.
 * @route DELETE /access/users/:id/roles/:roleId
 */
async function removeRoleFromUser(req, res) {
    const data = await requests.removeRoleFromUser(
        Number(req.params.id),
        Number(req.params.roleId),
        req.user
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
    const data = await requests.assignPermissionsToRole(
        Number(req.params.id),
        req.body.permission_ids,
        req.user
    );
    return respond.ok(res, data);
}

/**
 * Substitui completamente as permissões de um papel (operação atômica).
 * @route PUT /access/roles/:id/permissions
 */
async function setRolePermissions(req, res) {
    const data = await requests.setRolePermissions(
        Number(req.params.id),
        req.body.permission_ids,
        req.user
    );
    return respond.ok(res, data);
}

/**
 * Desassocia uma permissão de um papel.
 * @route DELETE /access/roles/:id/permissions/:permissionId
 */
async function removePermissionFromRole(req, res) {
    const data = await requests.removePermissionFromRole(
        Number(req.params.id),
        Number(req.params.permissionId),
        req.user
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
    const data = await requests.grantApplicationAccess(
        Number(req.params.id),
        req.body.application_id,
        req.user
    );
    return respond.ok(res, data);
}

/**
 * Revoga o acesso de um usuário a uma aplicação.
 * @route DELETE /access/users/:id/applications/:appId
 */
async function revokeApplicationAccess(req, res) {
    const data = await requests.revokeApplicationAccess(
        Number(req.params.id),
        Number(req.params.appId),
        req.user
    );
    return respond.ok(res, data);
}

// ─── Registro de alterações (revisão) ──────────────────────────────────────────

/**
 * Lista registros. Query: `status` (pending — padrão —, approved, rejected,
 * canceled ou `all`), `type`, `requested_by`, `target_user_id`, `page`, `limit`.
 * @route GET /access/requests
 */
async function getRequests(req, res) {
    const data = await requests.list(req.query);
    return respond.ok(res, data);
}

/**
 * Sino de quem revisa: total de pendentes, por tipo, e os 5 mais recentes.
 * @route GET /access/requests/summary
 */
async function getRequestsSummary(req, res) {
    const data = await requests.summary();
    return respond.ok(res, data);
}

/** @route GET /access/requests/:id */
async function getRequestById(req, res) {
    const data = await requests.getById(Number(req.params.id));
    return respond.ok(res, data);
}

/**
 * Mantém a alteração (só fecha o registro). Body opcional: `{ note }`.
 * @route PATCH /access/requests/:id/approve
 */
async function approveRequest(req, res) {
    const data = await requests.approve(Number(req.params.id), req.user, req.body?.note);
    return respond.ok(res, data);
}

/**
 * Recusa e desfaz a alteração. Body opcional: `{ note }`. O que não deu para
 * desfazer vem em `revert_result.skipped`.
 * @route PATCH /access/requests/:id/reject
 */
async function rejectRequest(req, res) {
    const data = await requests.reject(Number(req.params.id), req.user, req.body?.note);
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
    guardOwnerAccount,
    recordPasswordReset,
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
    revokeApplicationAccess,
    // Registro de alterações
    getRequests,
    getRequestsSummary,
    getRequestById,
    approveRequest,
    rejectRequest
};
