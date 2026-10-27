/**
 * @fileoverview Casos de uso — fila de aprovação da Gestão de Acessos.
 *
 * Toda rota de escrita que concede acesso passa por aqui em vez de chamar o
 * `AccessUseCases` direto. Para cada uma:
 *
 * - quem pede é `SYSTEM_OWNER` → aplica na hora (`{ pending: false, data }`);
 * - qualquer outro → grava um pedido `pending` (`{ pending: true, request }`)
 *   e nada muda até um `SYSTEM_OWNER` aprovar.
 *
 * A mudança é aplicada por `_apply`, o MESMO caminho nos dois casos — aprovar
 * um pedido dá exatamente o resultado que o dono teria tido fazendo à mão.
 * Quem fica como autor (`created_by`/`updated_by`) é quem pediu; quem aprovou
 * fica em `_access_requests.reviewed_by`.
 *
 * Regras de quem entra na fila: `domain/access/access-request.rules.js`.
 *
 * @module modules/global/application/access/access-request.use-cases
 */

const { AppError } = require('../../../../errors/app.error');
const {
    AccessRequestType: Type,
    AccessRequestStatus,
    AccessRequestAction,
    AccessErrorCode,
    values,
} = require('../../domain/access/access-request.enums');
const {
    isApprover,
    assertCanManageUser,
    userChangeGrantsAccess,
    normalizeIds,
    assertReviewable,
    assertCancelable,
    toPublicRequest,
} = require('../../domain/access/access-request.rules');
const { normalizePagination, paginated } = require('../../domain/shared/pagination.rules');

/** Quantos pedidos pendentes o `summary` traz para o dropdown do sino. */
const SUMMARY_LATEST = 5;

/** Campos que `PUT /access/users/:id` grava (`AccessUseCases.updateUser`). */
const PUT_USER_FIELDS = ['name', 'registration', 'branch_code', 'ad_status', 'administrator', 'table_protheus'];

class AccessRequestUseCases {
    /**
     * @param {{
     *   repository: import('./ports/access-request-repository.port').AccessRequestRepositoryPort,
     *   accessUseCases: import('./access.use-cases').AccessUseCases,
     *   eventPublisher?: import('./ports/access-request-event-publisher.port').AccessRequestEventPublisherPort,
     * }} deps - sem `eventPublisher`, não avisa ninguém.
     */
    constructor({ repository, accessUseCases, eventPublisher = null }) {
        this.repository = repository;
        this.access = accessUseCases;
        this.events = eventPublisher;
    }

    // ─── Entrada das rotas de escrita ───────────────────────────────────────

    /**
     * Cria o usuário já com papéis (`role_ids`) e aplicações
     * (`application_ids`), ambos opcionais. Para quem não é dono, é UM pedido
     * com tudo dentro — aprovar aplica tudo junto, numa transação.
     *
     * @throws {AppError} 400 (lista ou id inválido) / 409 (login em uso ou já pedido)
     */
    async createUser(payload, actor) {
        const role_ids = normalizeIds(payload.role_ids ?? [], { allowEmpty: true });
        const application_ids = normalizeIds(payload.application_ids ?? [], { allowEmpty: true });

        if (await this.repository.usernameExists(payload.user)) {
            throw new AppError(`Username '${payload.user}' já está em uso.`, 409, { code: AccessErrorCode.UsernameTaken });
        }
        if (await this.repository.hasPendingCreateUser(payload.user)) {
            throw new AppError(`Já existe um pedido pendente para criar '${payload.user}'.`, 409, { code: AccessErrorCode.RequestDuplicate });
        }
        // Conferido antes de gerar o pedido: o dono não deve aprovar algo que
        // vai falhar. Na aprovação, a FK ainda segura um papel apagado no meio.
        await this.access.assertRolesExist(role_ids);
        await this.access.assertApplicationsExist(application_ids);

        const data = await this.access.prepareNewUser(payload);
        return this._submit({ type: Type.CREATE_USER, payload: { ...data, role_ids, application_ids } }, actor);
    }

    /** PUT: só vai para a fila se mexer em `administrator` ou ativar o usuário. */
    async updateUser(payload, actor) {
        const current = await this.access.getUserById(payload.id);
        assertCanManageUser(current, actor);
        const id = payload.id;
        // Só o que o PUT grava: um campo extra no body (ex.: `password`) não
        // pode acabar guardado no pedido.
        const fields = Object.fromEntries(
            PUT_USER_FIELDS.filter(k => k in payload).map(k => [k, payload[k]])
        );
        if (!userChangeGrantsAccess(current, fields)) {
            return { pending: false, data: await this.access.updateUser(payload, actor.id) };
        }
        return this._submit({ type: Type.UPDATE_USER, targetUserId: id, payload: fields }, actor);
    }

    /** PATCH: idem ao PUT; o resto (nome, filial, senha, bloqueio) vale na hora. */
    async patchUser(id, fields, actor) {
        const current = await this.access.getUserById(id);
        assertCanManageUser(current, actor);
        const safeFields = await this.access.prepareUserPatch(fields);
        if (!userChangeGrantsAccess(current, safeFields)) {
            return { pending: false, data: await this.access.applyUserPatch(id, safeFields, actor.id) };
        }
        return this._submit({ type: Type.PATCH_USER, targetUserId: id, payload: safeFields }, actor);
    }

    /** Desativar não passa pela fila, mas conta de dono só outro dono desativa. */
    async deactivateUser(id, actor) {
        await this.assertCanManageUserById(id, actor);
        return this.access.deactivateUser(id, actor.id);
    }

    /**
     * Mesma trava, para rotas fora deste caso de uso (reset de senha, no
     * `auth.controller`, aplicado como middleware na rota).
     * @throws {AppError} 404 / 403
     */
    async assertCanManageUserById(id, actor) {
        assertCanManageUser(await this.access.getUserById(id), actor);
    }

    async assignRolesToUser(userId, roleIds, actor) {
        await this.access.getUserById(userId);
        const role_ids = normalizeIds(roleIds);
        return this._submit({ type: Type.ASSIGN_USER_ROLES, targetUserId: userId, payload: { role_ids } }, actor);
    }

    async removeRoleFromUser(userId, roleId, actor) {
        await this.access.getUserById(userId);
        await this.access.getRoleById(roleId);
        return this._submit({ type: Type.REMOVE_USER_ROLE, targetUserId: userId, targetRoleId: roleId, payload: {} }, actor);
    }

    async grantApplicationAccess(userId, applicationId, actor) {
        await this.access.getUserById(userId);
        const [application_id] = normalizeIds([applicationId]);
        return this._submit({ type: Type.GRANT_USER_APPLICATION, targetUserId: userId, payload: { application_id } }, actor);
    }

    async revokeApplicationAccess(userId, applicationId, actor) {
        await this.access.getUserById(userId);
        const [application_id] = normalizeIds([applicationId]);
        return this._submit({ type: Type.REVOKE_USER_APPLICATION, targetUserId: userId, payload: { application_id } }, actor);
    }

    async assignPermissionsToRole(roleId, permissionIds, actor) {
        await this.access.getRoleById(roleId);
        const permission_ids = normalizeIds(permissionIds);
        return this._submit({ type: Type.ASSIGN_ROLE_PERMISSIONS, targetRoleId: roleId, payload: { permission_ids } }, actor);
    }

    async setRolePermissions(roleId, permissionIds, actor) {
        await this.access.getRoleById(roleId);
        const permission_ids = normalizeIds(permissionIds, { allowEmpty: true });
        return this._submit({ type: Type.SET_ROLE_PERMISSIONS, targetRoleId: roleId, payload: { permission_ids } }, actor);
    }

    async removePermissionFromRole(roleId, permissionId, actor) {
        await this.access.getRoleById(roleId);
        await this.access.getPermissionById(permissionId);
        return this._submit({
            type: Type.REMOVE_ROLE_PERMISSION, targetRoleId: roleId, targetPermissionId: permissionId, payload: {},
        }, actor);
    }

    async updatePermission(payload, actor) {
        await this.access.getPermissionById(payload.id);
        return this._submit({
            type: Type.UPDATE_PERMISSION,
            targetPermissionId: payload.id,
            payload: { code: payload.code, description: payload.description ?? null },
        }, actor);
    }

    // ─── Fila ───────────────────────────────────────────────────────────────

    /**
     * Lista pedidos. `status` padrão `pending`; `status=all` traz todos.
     * @throws {AppError} 400 para status/tipo desconhecido
     */
    async list(query = {}) {
        const status = query.status === undefined ? AccessRequestStatus.PENDING
            : query.status === 'all' ? null
            : query.status;
        if (status !== null && !values(AccessRequestStatus).includes(status)) {
            throw new AppError(`Status inválido: ${status}.`, 400, { code: AccessErrorCode.InvalidRequestStatus });
        }
        const type = query.type || null;
        if (type !== null && !values(Type).includes(type)) {
            throw new AppError(`Tipo inválido: ${type}.`, 400, { code: AccessErrorCode.InvalidRequestType });
        }
        const filters = {
            status,
            type,
            requestedBy: positiveIntOrNull(query.requested_by),
            targetUserId: positiveIntOrNull(query.target_user_id),
        };
        const page = normalizePagination(query);
        const { rows, total } = await this.repository.findRequests(filters, page);
        return paginated(rows.map(toPublicRequest), total, page);
    }

    /** @throws {AppError} 404 */
    async getById(id) {
        return toPublicRequest(await this._findOrFail(id));
    }

    /**
     * Aprova e aplica. O pedido sai de `pending` ANTES de aplicar (dois donos
     * aprovando juntos não aplicam duas vezes); se a aplicação falhar (ex.: o
     * login foi criado por outro caminho nesse meio-tempo), volta para
     * `pending` e o erro sobe — o dono vê o motivo e pode recusar.
     *
     * @throws {AppError} 404 / 403 (próprio pedido) / 409 (já analisado)
     */
    async approve(id, reviewer) {
        const request = await this._findOrFail(id);
        assertReviewable(request, reviewer);
        await this._claim(id, AccessRequestStatus.APPROVED, reviewer.id, null);

        let result;
        try {
            result = await this._apply(request, request.requested_by);
        } catch (error) {
            await this.repository.releaseRequest(id);
            throw error;
        }

        if (request.type === Type.CREATE_USER) {
            await this.repository.setTargetUser(id, result.id);
        }
        const reviewed = await this.getById(id);
        await this._notify(AccessRequestAction.APPROVED, reviewed);
        return { request: reviewed, result };
    }

    /** @throws {AppError} 404 / 403 (próprio pedido) / 409 (já analisado) */
    async reject(id, reviewer, note) {
        const request = await this._findOrFail(id);
        assertReviewable(request, reviewer);
        await this._claim(id, AccessRequestStatus.REJECTED, reviewer.id, note ?? null);
        const reviewed = await this.getById(id);
        await this._notify(AccessRequestAction.REJECTED, reviewed);
        return reviewed;
    }

    /** Quem pediu desiste. @throws {AppError} 404 / 403 / 409 */
    async cancel(id, actor) {
        const request = await this._findOrFail(id);
        assertCancelable(request, actor);
        await this._claim(id, AccessRequestStatus.CANCELED, actor.id, null);
        const canceled = await this.getById(id);
        await this._notify(AccessRequestAction.CANCELED, canceled);
        return canceled;
    }

    /**
     * Sino do dono do sistema: quantos pedidos esperam análise e os mais
     * recentes. É estado, não aviso guardado — quando QUALQUER dono analisa,
     * o pedido sai do contador de todos.
     */
    async summary() {
        const byType = await this.repository.countPendingByType();
        const { rows } = await this.repository.findRequests(
            { status: AccessRequestStatus.PENDING, type: null, requestedBy: null, targetUserId: null },
            { limit: SUMMARY_LATEST, offset: 0 },
        );
        return {
            pending_total: Object.values(byType).reduce((sum, n) => sum + n, 0),
            pending_by_type: byType,
            latest: rows.map(toPublicRequest),
        };
    }

    // ─── Internos ───────────────────────────────────────────────────────────

    /** @private Dono aplica na hora; os demais geram pedido. */
    async _submit(change, actor) {
        if (isApprover(actor)) {
            return { pending: false, data: await this._apply(change, actor.id) };
        }
        const requestId = await this.repository.insertRequest({ ...change, requestedBy: actor.id });
        const request = await this.getById(requestId);
        await this._notify(AccessRequestAction.REQUESTED, request);
        return { pending: true, request };
    }

    /**
     * @private Aviso em tempo real. Todo dono recebe (o contador dele muda);
     * quem pediu recebe também a resposta (aprovado/recusado). Nunca lança: o
     * pedido já está gravado, e o sino se refaz pelo `summary`.
     */
    async _notify(action, request) {
        if (!this.events) return;
        try {
            const recipients = [...await this.repository.findApproverIds()];
            if (action === AccessRequestAction.APPROVED || action === AccessRequestAction.REJECTED) {
                recipients.push(Number(request.requested_by));
            }
            await this.events.publish(recipients, { action, request });
        } catch (error) {
            console.error(`[access:request] Falha ao avisar (${action}, id=${request?.id}):`, error.message);
        }
    }

    /**
     * @private Aplica a mudança descrita por um pedido (ou por um `change` de
     * `_submit`, que tem o mesmo formato em camelCase).
     */
    async _apply(change, authorId) {
        const payload = parsePayload(change.payload);
        const userId = change.targetUserId ?? change.target_user_id;
        const roleId = change.targetRoleId ?? change.target_role_id;
        const permissionId = change.targetPermissionId ?? change.target_permission_id;

        switch (change.type) {
            case Type.CREATE_USER: {
                // Pedidos anteriores a 27/10/2026 não têm as listas.
                const { role_ids = [], application_ids = [], ...userData } = payload;
                return this.access.insertPreparedUser(userData, authorId, {
                    roleIds: role_ids,
                    applicationIds: application_ids,
                });
            }
            case Type.UPDATE_USER:
                return this.access.updateUser({ ...payload, id: userId }, authorId);
            case Type.PATCH_USER:
                return this.access.applyUserPatch(userId, payload, authorId);
            case Type.ASSIGN_USER_ROLES:
                return this.access.assignRolesToUser(userId, payload.role_ids);
            case Type.REMOVE_USER_ROLE:
                return this.access.removeRoleFromUser(userId, roleId);
            case Type.GRANT_USER_APPLICATION:
                return this.access.grantApplicationAccess(userId, payload.application_id);
            case Type.REVOKE_USER_APPLICATION:
                return this.access.revokeApplicationAccess(userId, payload.application_id);
            case Type.ASSIGN_ROLE_PERMISSIONS:
                return this.access.assignPermissionsToRole(roleId, payload.permission_ids);
            case Type.SET_ROLE_PERMISSIONS:
                return this.access.setRolePermissions(roleId, payload.permission_ids);
            case Type.REMOVE_ROLE_PERMISSION:
                return this.access.removePermissionFromRole(roleId, permissionId);
            case Type.UPDATE_PERMISSION:
                return this.access.updatePermission({ ...payload, id: permissionId });
            default:
                throw new AppError(`Tipo de pedido desconhecido: ${change.type}.`, 400, { code: AccessErrorCode.InvalidRequestType });
        }
    }

    /** @private */
    async _findOrFail(id) {
        const request = await this.repository.findRequestById(id);
        if (!request) throw new AppError('Pedido não encontrado.', 404, { code: AccessErrorCode.RequestNotFound });
        return request;
    }

    /** @private Perdeu a corrida para outro revisor → 409. */
    async _claim(id, status, by, note) {
        const claimed = await this.repository.claimRequest(id, status, by, note);
        if (!claimed) {
            throw new AppError('Este pedido já foi analisado.', 409, { code: AccessErrorCode.RequestNotPending });
        }
    }
}

/** JSON do MySQL vem objeto (MySQL 8) ou texto (MariaDB). */
function parsePayload(payload) {
    return typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
}

function positiveIntOrNull(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
}

module.exports = { AccessRequestUseCases };
