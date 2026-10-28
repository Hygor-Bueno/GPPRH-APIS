/**
 * @fileoverview Casos de uso — registro e revisão das alterações da Gestão de
 * Acessos.
 *
 * Toda rota de escrita de `/access/*` passa por aqui em vez de chamar o
 * `AccessUseCases` direto. Cada alteração:
 *
 * 1. passa pelas travas (`SYSTEM_OWNER` intocável, `ACCESS_APPROVE` só pelo
 *    dono, próprio cadastro, conta de dono — `domain/access/access-request.rules.js`);
 * 2. tira a foto do que vai mudar (`previous_state`);
 * 3. grava o registro e só então aplica — não existe alteração sem registro.
 *    Se aplicar falhar, o registro é apagado;
 * 4. de dono do sistema nasce `approved`; dos demais, `pending` — aplicada,
 *    aguardando quem tem `ACCESS_APPROVE`.
 *
 * Revisar: aprovar só fecha o registro; recusar DESFAZ a alteração pela foto
 * (`_revert`), sem pisar no que alguém mudou depois.
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
    OWNER_PERMISSION,
    REVIEW_PERMISSION,
    isOwner,
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
} = require('../../domain/access/access-request.rules');
const { normalizePagination, paginated } = require('../../domain/shared/pagination.rules');

/** Quantas alterações pendentes o `summary` traz para o dropdown do sino. */
const SUMMARY_LATEST = 5;

/** Nota do registro de alteração feita por dono do sistema. */
const OWNER_NOTE = 'Feita por dono do sistema.';

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

    // ─── Usuários ───────────────────────────────────────────────────────────

    /**
     * Cria o usuário já com papéis (`role_ids`) e aplicações
     * (`application_ids`), ambos opcionais, numa transação só.
     *
     * @throws {AppError} 400 (lista ou id inválido) / 403 (papel de dono) / 409 (login em uso)
     */
    async createUser(payload, actor) {
        const role_ids = normalizeIds(payload.role_ids ?? [], { allowEmpty: true });
        const application_ids = normalizeIds(payload.application_ids ?? [], { allowEmpty: true });

        if (await this.repository.usernameExists(payload.user)) {
            throw new AppError(`Username '${payload.user}' já está em uso.`, 409, { code: AccessErrorCode.UsernameTaken });
        }
        await this._assertRolesGrantable(role_ids, actor);
        await this.access.assertRolesExist(role_ids);
        await this.access.assertApplicationsExist(application_ids);

        const data = await this.access.prepareNewUser(payload);
        return this._record({
            type: Type.CREATE_USER,
            payload: { ...data, role_ids, application_ids },
            apply: () => this.access.insertPreparedUser(data, actor.id, {
                roleIds: role_ids,
                applicationIds: application_ids,
            }),
            createdTargets: user => ({ targetUserId: user.id }),
        }, actor);
    }

    /** PUT: grava todos os campos do PUT, com os padrões dele. */
    async updateUser(payload, actor) {
        const current = await this._manageableUser(payload.id, actor);
        const fields = this.access.prepareUserUpdate(payload);
        return this._record({
            type: Type.UPDATE_USER,
            targetUserId: current.id,
            payload: fields,
            previous: pick(current, Object.keys(fields)),
            apply: () => this.access.updateUser({ ...fields, id: current.id }, actor.id),
        }, actor);
    }

    /** PATCH: só os campos enviados. A senha vai em hash e não tem "antes". */
    async patchUser(id, fields, actor) {
        const current = await this._manageableUser(id, actor);
        const safeFields = await this.access.prepareUserPatch(fields);
        const { password, ...visible } = safeFields;
        return this._record({
            type: Type.PATCH_USER,
            targetUserId: current.id,
            payload: safeFields,
            previous: pick(current, Object.keys(visible)),
            apply: () => this.access.applyUserPatch(current.id, safeFields, actor.id),
        }, actor);
    }

    async deactivateUser(id, actor) {
        const current = await this._manageableUser(id, actor);
        return this._record({
            type: Type.DEACTIVATE_USER,
            targetUserId: current.id,
            payload: { ad_status: 'delete' },
            previous: { ad_status: current.ad_status },
            apply: () => this.access.deactivateUser(current.id, actor.id),
        }, actor);
    }

    /**
     * Mesmas travas, para a rota de reset de senha, que mora no
     * `auth.controller` (aplicada como middleware na rota).
     * @throws {AppError} 404 / 403
     */
    async assertCanManageUserById(id, actor) {
        await this._manageableUser(id, actor);
    }

    /**
     * Registra um reset de senha já feito pelo `auth.controller`. A senha
     * temporária não é guardada, e um reset não tem como ser desfeito.
     */
    async recordPasswordReset(userId, actor) {
        return this._record({
            type: Type.RESET_PASSWORD,
            targetUserId: userId,
            apply: async () => null,
        }, actor);
    }

    async assignRolesToUser(userId, roleIds, actor) {
        const user = await this._manageableUser(userId, actor);
        const role_ids = normalizeIds(roleIds);
        await this._assertRolesGrantable(role_ids, actor);
        await this.access.assertRolesExist(role_ids);
        return this._record({
            type: Type.ASSIGN_USER_ROLES,
            targetUserId: user.id,
            payload: { role_ids },
            previous: { role_ids: await this._userRoleIds(user.id) },
            apply: () => this.access.assignRolesToUser(user.id, role_ids),
        }, actor);
    }

    async removeRoleFromUser(userId, roleId, actor) {
        const user = await this._manageableUser(userId, actor);
        await this.access.getRoleById(roleId);
        await this._assertRolesGrantable([roleId], actor);
        return this._record({
            type: Type.REMOVE_USER_ROLE,
            targetUserId: user.id,
            targetRoleId: roleId,
            previous: { had: (await this._userRoleIds(user.id)).includes(Number(roleId)) },
            apply: () => this.access.removeRoleFromUser(user.id, roleId),
        }, actor);
    }

    async grantApplicationAccess(userId, applicationId, actor) {
        const user = await this._manageableUser(userId, actor);
        const [application_id] = normalizeIds([applicationId]);
        return this._record({
            type: Type.GRANT_USER_APPLICATION,
            targetUserId: user.id,
            payload: { application_id },
            previous: { had: (await this._userApplicationIds(user.id)).includes(application_id) },
            apply: () => this.access.grantApplicationAccess(user.id, application_id),
        }, actor);
    }

    async revokeApplicationAccess(userId, applicationId, actor) {
        const user = await this._manageableUser(userId, actor);
        const [application_id] = normalizeIds([applicationId]);
        return this._record({
            type: Type.REVOKE_USER_APPLICATION,
            targetUserId: user.id,
            payload: { application_id },
            previous: { had: (await this._userApplicationIds(user.id)).includes(application_id) },
            apply: () => this.access.revokeApplicationAccess(user.id, application_id),
        }, actor);
    }

    // ─── Papéis ─────────────────────────────────────────────────────────────

    async createRole(payload, actor) {
        const data = { name: payload.name.toUpperCase(), description: payload.description ?? null };
        return this._record({
            type: Type.CREATE_ROLE,
            payload: data,
            apply: () => this.access.createRole(data),
            createdTargets: role => ({ targetRoleId: role.id }),
        }, actor);
    }

    async updateRole(payload, actor) {
        const role = await this._editableRole(payload.id, actor);
        const data = { name: payload.name.toUpperCase(), description: payload.description ?? null };
        return this._record({
            type: Type.UPDATE_ROLE,
            targetRoleId: role.id,
            payload: data,
            previous: { name: role.name, description: role.description ?? null },
            apply: () => this.access.updateRole({ ...data, id: role.id }),
        }, actor);
    }

    /** A exclusão leva as permissões do papel junto (cascata): a foto guarda as duas coisas. */
    async deleteRole(id, actor) {
        const role = await this._editableRole(id, actor);
        return this._record({
            type: Type.DELETE_ROLE,
            targetRoleId: role.id,
            previous: {
                name: role.name,
                description: role.description ?? null,
                permission_ids: await this._rolePermissionIds(role.id),
            },
            apply: () => this.access.deleteRole(role.id),
        }, actor);
    }

    async assignPermissionsToRole(roleId, permissionIds, actor) {
        const role = await this._editableRole(roleId, actor);
        const permission_ids = normalizeIds(permissionIds);
        await this._assertPermissionsGrantable(permission_ids, actor);
        return this._record({
            type: Type.ASSIGN_ROLE_PERMISSIONS,
            targetRoleId: role.id,
            payload: { permission_ids },
            previous: { permission_ids: await this._rolePermissionIds(role.id) },
            apply: () => this.access.assignPermissionsToRole(role.id, permission_ids),
        }, actor);
    }

    async setRolePermissions(roleId, permissionIds, actor) {
        const role = await this._editableRole(roleId, actor);
        const permission_ids = normalizeIds(permissionIds, { allowEmpty: true });
        await this._assertPermissionsGrantable(permission_ids, actor);
        return this._record({
            type: Type.SET_ROLE_PERMISSIONS,
            targetRoleId: role.id,
            payload: { permission_ids },
            previous: { permission_ids: await this._rolePermissionIds(role.id) },
            apply: () => this.access.setRolePermissions(role.id, permission_ids),
        }, actor);
    }

    async removePermissionFromRole(roleId, permissionId, actor) {
        const role = await this._editableRole(roleId, actor);
        await this.access.getPermissionById(permissionId);
        return this._record({
            type: Type.REMOVE_ROLE_PERMISSION,
            targetRoleId: role.id,
            targetPermissionId: permissionId,
            previous: { had: (await this._rolePermissionIds(role.id)).includes(Number(permissionId)) },
            apply: () => this.access.removePermissionFromRole(role.id, permissionId),
        }, actor);
    }

    // ─── Permissões ─────────────────────────────────────────────────────────

    async createPermission(payload, actor) {
        const data = { code: payload.code.toUpperCase(), description: payload.description ?? null };
        return this._record({
            type: Type.CREATE_PERMISSION,
            payload: data,
            apply: () => this.access.createPermission(data),
            createdTargets: permission => ({ targetPermissionId: permission.id }),
        }, actor);
    }

    /** Renomear o código de uma permissão muda o acesso de todo papel que a tem. */
    async updatePermission(payload, actor) {
        const permission = await this._editablePermission(payload.id, actor);
        const data = { code: payload.code.toUpperCase(), description: payload.description ?? null };
        return this._record({
            type: Type.UPDATE_PERMISSION,
            targetPermissionId: permission.id,
            payload: data,
            previous: { code: permission.code, description: permission.description ?? null },
            apply: () => this.access.updatePermission({ ...data, id: permission.id }),
        }, actor);
    }

    async deletePermission(id, actor) {
        const permission = await this._editablePermission(id, actor);
        return this._record({
            type: Type.DELETE_PERMISSION,
            targetPermissionId: permission.id,
            previous: { code: permission.code, description: permission.description ?? null },
            apply: () => this.access.deletePermission(permission.id),
        }, actor);
    }

    // ─── Registro e revisão ─────────────────────────────────────────────────

    /**
     * Lista registros. `status` padrão `pending`; `status=all` traz todos.
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
     * Mantém a alteração: só fecha o registro.
     * @throws {AppError} 404 / 403 (própria alteração ou próprio cadastro) / 409 (já revisada)
     */
    async approve(id, reviewer, note) {
        const request = await this._findOrFail(id);
        assertReviewable(request, reviewer);
        await this._claim(id, AccessRequestStatus.APPROVED, reviewer.id, note ?? null);
        const reviewed = await this.getById(id);
        await this._notify(AccessRequestAction.APPROVED, reviewed);
        return reviewed;
    }

    /**
     * Recusa e DESFAZ a alteração. O registro sai de `pending` antes (dois
     * revisores juntos não desfazem duas vezes); se desfazer der erro de
     * banco, volta para `pending` e o erro sobe. O que não deu para desfazer
     * (alguém mudou de novo depois, senha resetada…) fica em `revert_result`.
     *
     * @throws {AppError} 404 / 403 / 409
     */
    async reject(id, reviewer, note) {
        const request = await this._findOrFail(id);
        assertReviewable(request, reviewer);
        await this._claim(id, AccessRequestStatus.REJECTED, reviewer.id, note ?? null);

        let result;
        try {
            result = await this._revert(request, reviewer.id);
        } catch (error) {
            await this.repository.releaseRequest(id);
            throw error;
        }

        await this.repository.setRevertResult(id, result);
        const reviewed = await this.getById(id);
        await this._notify(AccessRequestAction.REJECTED, reviewed);
        return reviewed;
    }

    /**
     * Sino de quem revisa: quantas alterações esperam revisão e as mais
     * recentes. É estado, não aviso guardado — quando QUALQUER revisor
     * analisa, o registro sai do contador de todos.
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

    /**
     * @private Grava o registro, aplica e devolve o resultado da alteração.
     * `createdTargets(resultado)` dá o id do que foi criado, que só existe
     * depois de aplicar.
     */
    async _record({ type, targetUserId = null, targetRoleId = null, targetPermissionId = null,
        payload = {}, previous = null, apply, createdTargets = null }, actor) {
        const byOwner = isOwner(actor);
        const requestId = await this.repository.insertRequest({
            type,
            targetUserId,
            targetRoleId,
            targetPermissionId,
            payload,
            previousState: previous,
            status: byOwner ? AccessRequestStatus.APPROVED : AccessRequestStatus.PENDING,
            requestedBy: actor.id,
            reviewedBy: byOwner ? actor.id : null,
            reviewNote: byOwner ? OWNER_NOTE : null,
        });

        let data;
        try {
            data = await apply();
        } catch (error) {
            await this._discard(requestId);
            throw error;
        }

        if (createdTargets) await this.repository.setTargets(requestId, createdTargets(data));
        if (!byOwner) await this._notify(AccessRequestAction.REQUESTED, await this.getById(requestId));
        return data;
    }

    /** @private Registro de alteração que não aconteceu. Nunca lança: o erro que importa é o da alteração. */
    async _discard(requestId) {
        try {
            await this.repository.deleteRequest(requestId);
        } catch (error) {
            console.error(`[access:request] Falha ao apagar o registro ${requestId} de alteração que falhou:`, error.message);
        }
    }

    /**
     * @private Desfaz a alteração pela foto do registro. Cada passo que
     * esbarra num 4xx (o usuário/papel não existe mais, nome já reusado…)
     * vira um item de `skipped` em vez de parar tudo; erro de banco sobe.
     *
     * @returns {Promise<{complete: boolean, undone: string[], skipped: string[]}>}
     */
    async _revert(request, reviewerId) {
        const payload = parseJson(request.payload) || {};
        const previous = parseJson(request.previous_state) || {};
        const userId = request.target_user_id;
        const roleId = request.target_role_id;
        const permissionId = request.target_permission_id;
        const undone = [];
        const skipped = [];

        /** 4xx vira `skipped` e devolve `undefined`; erro de banco sobe. */
        const attempt = async (label, fn) => {
            try {
                return { ok: true, value: await fn() };
            } catch (error) {
                if (!(error instanceof AppError) || error.statusCode >= 500) throw error;
                skipped.push(`${label}: ${error.message}`);
                return { ok: false };
            }
        };
        const step = async (label, fn) => {
            if ((await attempt(label, fn)).ok) undone.push(label);
        };
        /** Campos: só volta o que ainda está como a alteração deixou. */
        const restoreFields = async (label, load, applied, restore) => {
            const { ok, value: current } = await attempt(label, load);
            if (!ok) return;
            const { restore: fields, skipped: changedSince } = fieldRevert(previous, applied, current);
            for (const key of changedSince) skipped.push(`${key}: foi alterado de novo depois; ficou como está.`);
            if (Object.keys(fields).length) {
                await step(`${Object.keys(fields).join(', ')} restaurado(s)`, () => restore(fields, current));
            }
        };

        switch (request.type) {
            case Type.CREATE_USER: {
                if (!userId) { skipped.push('O usuário criado não existe mais.'); break; }
                await step('usuário desativado', () => this.access.deactivateUser(userId, reviewerId));
                for (const id of payload.role_ids ?? []) {
                    await step(`papel ${id} retirado`, () => this.access.removeRoleFromUser(userId, id));
                }
                for (const id of payload.application_ids ?? []) {
                    await step(`aplicação ${id} revogada`, () => this.access.revokeApplicationAccess(userId, id));
                }
                break;
            }
            case Type.UPDATE_USER:
            case Type.PATCH_USER:
            case Type.DEACTIVATE_USER: {
                const { password, ...applied } = payload;
                await restoreFields('usuário', () => this.access.getUserById(userId), applied,
                    fields => this.access.applyUserPatch(userId, fields, reviewerId));
                if (password !== undefined) skipped.push('senha: a anterior não é guardada; resete a senha se preciso.');
                break;
            }
            case Type.RESET_PASSWORD:
                skipped.push('Reset de senha não tem como ser desfeito: resete de novo ou bloqueie o usuário.');
                break;
            case Type.ASSIGN_USER_ROLES: {
                const { remove } = listRevert(previous.role_ids ?? [], [...(previous.role_ids ?? []), ...(payload.role_ids ?? [])]);
                for (const id of remove) {
                    await step(`papel ${id} retirado`, () => this.access.removeRoleFromUser(userId, id));
                }
                break;
            }
            case Type.REMOVE_USER_ROLE:
                if (previous.had) await step(`papel ${roleId} devolvido`, () => this.access.assignRolesToUser(userId, [roleId]));
                break;
            case Type.GRANT_USER_APPLICATION:
                if (!previous.had) {
                    await step(`aplicação ${payload.application_id} revogada`,
                        () => this.access.revokeApplicationAccess(userId, payload.application_id));
                }
                break;
            case Type.REVOKE_USER_APPLICATION:
                if (previous.had) {
                    await step(`aplicação ${payload.application_id} devolvida`,
                        () => this.access.grantApplicationAccess(userId, payload.application_id));
                }
                break;
            case Type.CREATE_ROLE:
                await step('papel excluído', () => this.access.deleteRole(roleId));
                break;
            case Type.UPDATE_ROLE:
                await restoreFields('papel', () => this.access.getRoleById(roleId), payload,
                    (fields, role) => this.access.updateRole({
                        id: roleId, name: role.name, description: role.description, ...fields,
                    }));
                break;
            case Type.DELETE_ROLE:
                await step('papel recriado com as permissões', () => this.access.restoreRole(
                    { id: roleId, name: previous.name, description: previous.description },
                    previous.permission_ids ?? [],
                ));
                break;
            case Type.ASSIGN_ROLE_PERMISSIONS:
            case Type.SET_ROLE_PERMISSIONS: {
                const after = request.type === Type.SET_ROLE_PERMISSIONS
                    ? payload.permission_ids ?? []
                    : [...(previous.permission_ids ?? []), ...(payload.permission_ids ?? [])];
                const { remove, add } = listRevert(previous.permission_ids ?? [], after);
                for (const id of remove) {
                    await step(`permissão ${id} retirada`, () => this.access.removePermissionFromRole(roleId, id));
                }
                if (add.length) {
                    await step(`permissões ${add.join(', ')} devolvidas`, () => this.access.assignPermissionsToRole(roleId, add));
                }
                break;
            }
            case Type.REMOVE_ROLE_PERMISSION:
                if (previous.had) {
                    await step(`permissão ${permissionId} devolvida`,
                        () => this.access.assignPermissionsToRole(roleId, [permissionId]));
                }
                break;
            case Type.CREATE_PERMISSION:
                await step('permissão excluída', () => this.access.deletePermission(permissionId));
                break;
            case Type.UPDATE_PERMISSION:
                await restoreFields('permissão', () => this.access.getPermissionById(permissionId), payload,
                    (fields, permission) => this.access.updatePermission({
                        id: permissionId, code: permission.code, description: permission.description, ...fields,
                    }));
                break;
            case Type.DELETE_PERMISSION:
                await step('permissão recriada', () => this.access.restorePermission(
                    { id: permissionId, code: previous.code, description: previous.description },
                ));
                break;
            default:
                throw new AppError(`Tipo de registro desconhecido: ${request.type}.`, 400, { code: AccessErrorCode.InvalidRequestType });
        }

        return { complete: skipped.length === 0, undone, skipped };
    }

    /**
     * @private Aviso em tempo real. Todo revisor recebe (o contador dele
     * muda); o autor recebe também a revisão. Nunca lança: o registro já
     * está gravado, e o sino se refaz pelo `summary`.
     */
    async _notify(action, request) {
        if (!this.events) return;
        try {
            const recipients = [...await this.repository.findReviewerIds()];
            if (action !== AccessRequestAction.REQUESTED) recipients.push(Number(request.requested_by));
            await this.events.publish(recipients, { action, request });
        } catch (error) {
            console.error(`[access:request] Falha ao avisar (${action}, id=${request?.id}):`, error.message);
        }
    }

    /** @private Usuário que `actor` pode alterar. @throws {AppError} 404 / 403 */
    async _manageableUser(id, actor) {
        const user = await this.access.getUserById(id);
        assertCanManageUser(user, actor);
        return user;
    }

    /**
     * @private Papéis que `actor` pode dar, tirar ou editar: nunca o de dono;
     * o de revisor, só se for dono. @throws {AppError} 403
     */
    async _assertRolesGrantable(roleIds, actor) {
        assertRolesNotProtected(roleIds, await this.repository.findRoleIdsWithPermission(OWNER_PERMISSION));
        if (!isOwner(actor)) {
            assertRolesNotReviewer(roleIds, await this.repository.findRoleIdsWithPermission(REVIEW_PERMISSION), actor);
        }
    }

    /** @private Mesma regra, para permissões. @throws {AppError} 403 */
    async _assertPermissionsGrantable(permissionIds, actor) {
        assertNoOwnerPermission(permissionIds, await this.repository.findPermissionIdByCode(OWNER_PERMISSION));
        if (!isOwner(actor)) {
            assertNoReviewPermission(permissionIds, await this.repository.findPermissionIdByCode(REVIEW_PERMISSION), actor);
        }
    }

    /**
     * @private Papel que `actor` pode alterar: não é de dono, não é de
     * revisor (fora o dono) e não é dele. @throws {AppError} 404 / 403
     */
    async _editableRole(id, actor) {
        const role = await this.access.getRoleById(id);
        await this._assertRolesGrantable([role.id], actor);
        assertNotOwnRole(role.id, await this._userRoleIds(actor.id), actor);
        return role;
    }

    /** @private Nunca `SYSTEM_OWNER`; `ACCESS_APPROVE` só o dono. @throws {AppError} 404 / 403 */
    async _editablePermission(id, actor) {
        const permission = await this.access.getPermissionById(id);
        await this._assertPermissionsGrantable([permission.id], actor);
        return permission;
    }

    /** @private */
    async _userRoleIds(userId) {
        return (await this.access.getUserRoles(userId)).map(r => Number(r.id));
    }

    /** @private */
    async _userApplicationIds(userId) {
        return (await this.access.getUserApplications(userId)).map(a => Number(a.id));
    }

    /** @private */
    async _rolePermissionIds(roleId) {
        return (await this.access.getRolePermissions(roleId)).map(p => Number(p.id));
    }

    /** @private */
    async _findOrFail(id) {
        const request = await this.repository.findRequestById(id);
        if (!request) throw new AppError('Registro não encontrado.', 404, { code: AccessErrorCode.RequestNotFound });
        return request;
    }

    /** @private Perdeu a corrida para outro revisor → 409. */
    async _claim(id, status, by, note) {
        const claimed = await this.repository.claimRequest(id, status, by, note);
        if (!claimed) {
            throw new AppError('Esta alteração já foi revisada.', 409, { code: AccessErrorCode.RequestNotPending });
        }
    }
}

/** Só as chaves pedidas, com `undefined` virando `null` (vai para JSON). */
function pick(source, keys) {
    return Object.fromEntries(keys.map(k => [k, source[k] ?? null]));
}

function positiveIntOrNull(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
}

module.exports = { AccessRequestUseCases };
