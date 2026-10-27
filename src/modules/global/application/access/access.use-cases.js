/**
 * @fileoverview Casos de uso — Gestão de Acessos (usuários, papéis, permissões, aplicações).
 * @module modules/global/application/access/access.use-cases
 */

const bcrypt = require('bcryptjs');
const { AppError } = require('../../../../errors/app.error');
const { PATCH_USER_FIELDS } = require('../../repositories/mysql/access.queries');
const { AccessErrorCode } = require('../../domain/access/access-request.enums');

/** Custo do hash bcrypt para senhas de usuário. */
const BCRYPT_ROUNDS = 10;

class AccessUseCases {
    /** @param {{repository: import('./ports/access-repository.port').AccessRepositoryPort}} deps */
    constructor({ repository }) {
        this.repository = repository;
    }

    // ─── Usuários ───────────────────────────────────────────────────────────

    async getUsers(filters = {}) {
        return this.repository.findUsers(filters);
    }

    /** @throws {AppError} 404 */
    async getUserById(id) {
        const user = await this.repository.findUserById(id);
        if (!user) throw new AppError('Usuário não encontrado', 404, { code: AccessErrorCode.UserNotFound });
        return user;
    }

    /**
     * Cria um novo usuário com senha hasheada. Se `password` não for informado,
     * usa o padrão `'1234'` (destinado a usuários que autenticam via AD).
     */
    async createUser(payload, createdBy) {
        return this.insertPreparedUser(await this.prepareNewUser(payload), createdBy);
    }

    /**
     * Normaliza o payload de criação e já hasheia a senha — é este objeto que
     * fica gravado num pedido de criação pendente, nunca a senha em claro.
     */
    async prepareNewUser(payload) {
        const rawPassword = payload.password || '1234';
        return {
            user: payload.user,
            password: await bcrypt.hash(rawPassword, BCRYPT_ROUNDS),
            name: payload.name ?? null,
            registration: payload.registration ?? null,
            branch_code: payload.branch_code ?? null,
            ad_status: payload.ad_status ?? 'pending',
            administrator: payload.administrator ?? 0,
            table_protheus: payload.table_protheus ?? null,
        };
    }

    /**
     * @param {object} data - saída de `prepareNewUser` (senha já hasheada).
     * @param {number} createdBy
     * @param {{roleIds?: number[], applicationIds?: number[]}} [access] - papéis e
     *   aplicações já na criação, na mesma transação do usuário.
     */
    async insertPreparedUser(data, createdBy, { roleIds = [], applicationIds = [] } = {}) {
        let insertId;
        try {
            ({ insertId } = roleIds.length || applicationIds.length
                ? await this.repository.insertUserWithAccess(data, createdBy, roleIds, applicationIds)
                : await this.repository.insertUser(data, createdBy));
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                throw new AppError(`Username '${data.user}' já está em uso.`, 409);
            }
            throw error;
        }

        return this.getUserById(insertId);
    }

    /** @throws {AppError} 400 `ACCESS_UNKNOWN_ROLE` citando os ids que não existem */
    async assertRolesExist(roleIds) {
        const found = new Set(await this.repository.findExistingRoleIds(roleIds));
        const missing = roleIds.filter(id => !found.has(id));
        if (missing.length) {
            throw new AppError(`Papel inexistente: ${missing.join(', ')}.`, 400, { code: AccessErrorCode.UnknownRole });
        }
    }

    /** @throws {AppError} 400 `ACCESS_UNKNOWN_APPLICATION` citando os ids que não existem */
    async assertApplicationsExist(applicationIds) {
        const found = new Set(await this.repository.findExistingApplicationIds(applicationIds));
        const missing = applicationIds.filter(id => !found.has(id));
        if (missing.length) {
            throw new AppError(`Aplicação inexistente: ${missing.join(', ')}.`, 400, { code: AccessErrorCode.UnknownApplication });
        }
    }

    /** Atualiza completamente um usuário (PUT). Não altera senha nem campos de AD. */
    async updateUser(payload, updatedBy) {
        await this.repository.updateUser({
            name: payload.name ?? null,
            registration: payload.registration ?? null,
            branch_code: payload.branch_code ?? null,
            ad_status: payload.ad_status ?? 'pending',
            administrator: payload.administrator ?? 0,
            table_protheus: payload.table_protheus ?? null,
            id: payload.id,
        }, updatedBy);
        return this.getUserById(payload.id);
    }

    /**
     * Atualiza parcialmente um usuário (PATCH). Campos são filtrados contra a
     * whitelist `PATCH_USER_FIELDS`; `password`, se presente, é hasheada.
     * @throws {AppError} 400 se nenhum campo válido for enviado
     */
    async patchUser(id, fields, updatedBy) {
        return this.applyUserPatch(id, await this.prepareUserPatch(fields), updatedBy);
    }

    /**
     * Filtra os campos contra a whitelist e hasheia `password` — é este objeto
     * que fica gravado num pedido de edição pendente.
     * @throws {AppError} 400 se nenhum campo válido for enviado
     */
    async prepareUserPatch(fields) {
        const safeFields = Object.fromEntries(
            Object.entries(fields).filter(([k]) => PATCH_USER_FIELDS[k])
        );

        if (!Object.keys(safeFields).length) {
            throw new AppError('Nenhum campo válido fornecido para atualização.', 400);
        }

        if (safeFields.password) {
            safeFields.password = await bcrypt.hash(safeFields.password, BCRYPT_ROUNDS);
        }

        return safeFields;
    }

    /** @param {object} safeFields - saída de `prepareUserPatch` (senha já hasheada). */
    async applyUserPatch(id, safeFields, updatedBy) {
        const fieldNames = Object.keys(safeFields);
        const fieldValues = Object.values(safeFields);

        await this.repository.patchUser(id, fieldNames, fieldValues, updatedBy);
        return this.getUserById(id);
    }

    /** Desativa um usuário (soft-delete: ad_status = 'delete'). */
    async deactivateUser(id, updatedBy) {
        await this.getUserById(id);
        await this.repository.deactivateUser(id, updatedBy);
        return { deactivated: true };
    }

    // ─── Papéis (Roles) ─────────────────────────────────────────────────────

    async getRoles() {
        return this.repository.findRoles();
    }

    /** @throws {AppError} 404 */
    async getRoleById(id) {
        const role = await this.repository.findRoleById(id);
        if (!role) throw new AppError('Papel não encontrado', 404, { code: AccessErrorCode.RoleNotFound });
        return role;
    }

    /** @throws {AppError} 409 se o nome já existir */
    async createRole(payload) {
        let insertId;
        try {
            ({ insertId } = await this.repository.insertRole({
                name: payload.name.toUpperCase(),
                description: payload.description ?? null,
            }));
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                throw new AppError(`Papel '${payload.name}' já existe.`, 409);
            }
            throw error;
        }
        return this.getRoleById(insertId);
    }

    /** @throws {AppError} 404 / 409 se o novo nome já existir */
    async updateRole(payload) {
        await this.getRoleById(payload.id);
        try {
            await this.repository.updateRole({
                id: payload.id,
                name: payload.name.toUpperCase(),
                description: payload.description ?? null,
            });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                throw new AppError(`Papel '${payload.name}' já existe.`, 409);
            }
            throw error;
        }
        return this.getRoleById(payload.id);
    }

    /** @throws {AppError} 404 / 409 se houver usuários com este papel */
    async deleteRole(id) {
        await this.getRoleById(id);

        const total = await this.repository.countUsersByRole(id);
        if (total > 0) {
            throw new AppError(`Não é possível excluir: ${total} usuário(s) possuem este papel.`, 409);
        }

        await this.repository.deleteRole(id);
        return { deleted: true };
    }

    // ─── Permissões ─────────────────────────────────────────────────────────

    async getPermissions() {
        return this.repository.findPermissions();
    }

    /** @throws {AppError} 409 se o código já existir */
    async createPermission(payload) {
        try {
            return await this.repository.insertPermission({
                code: payload.code.toUpperCase(),
                description: payload.description ?? null,
            });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                throw new AppError(`Permissão '${payload.code}' já existe.`, 409);
            }
            throw error;
        }
    }

    /** @throws {AppError} 404 */
    async getPermissionById(id) {
        const permission = await this.repository.findPermissionById(id);
        if (!permission) throw new AppError('Permissão não encontrada', 404, { code: AccessErrorCode.PermissionNotFound });
        return permission;
    }

    /** @throws {AppError} 404 / 409 se o novo código já existir */
    async updatePermission(payload) {
        await this.getPermissionById(payload.id);

        try {
            return await this.repository.updatePermission({
                id: payload.id,
                code: payload.code.toUpperCase(),
                description: payload.description ?? null,
            });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                throw new AppError(`Permissão '${payload.code}' já existe.`, 409);
            }
            throw error;
        }
    }

    /** @throws {AppError} 404 / 409 se estiver em uso por algum papel */
    async deletePermission(id) {
        await this.getPermissionById(id);

        const total = await this.repository.countRolesByPermission(id);
        if (total > 0) {
            throw new AppError(`Não é possível excluir: ${total} papel(éis) utilizam esta permissão.`, 409);
        }

        await this.repository.deletePermission(id);
        return { deleted: true };
    }

    // ─── Vínculos Usuário ↔ Papel ───────────────────────────────────────────

    /** @throws {AppError} 404 */
    async getUserRoles(userId) {
        await this.getUserById(userId);
        return this.repository.findUserRoles(userId);
    }

    /** Associa um ou mais papéis a um usuário (vínculos já existentes são ignorados). */
    async assignRolesToUser(userId, roleIds) {
        await this.getUserById(userId);
        await this.repository.insertUserRoles(userId, roleIds);
        return this.repository.findUserRoles(userId);
    }

    /** @throws {AppError} 404 */
    async removeRoleFromUser(userId, roleId) {
        await this.getUserById(userId);
        await this.repository.deleteUserRole(userId, roleId);
        return { removed: true };
    }

    // ─── Vínculos Papel ↔ Permissão ─────────────────────────────────────────

    /** @throws {AppError} 404 */
    async getRolePermissions(roleId) {
        await this.getRoleById(roleId);
        return this.repository.findRolePermissions(roleId);
    }

    async assignPermissionsToRole(roleId, permissionIds) {
        await this.getRoleById(roleId);
        await this.repository.insertRolePermissions(roleId, permissionIds);
        return this.repository.findRolePermissions(roleId);
    }

    /** @throws {AppError} 404 */
    async removePermissionFromRole(roleId, permissionId) {
        await this.getRoleById(roleId);
        await this.repository.deleteRolePermission(roleId, permissionId);
        return { removed: true };
    }

    /** Substitui atomicamente todas as permissões de um papel. */
    async setRolePermissions(roleId, permissionIds) {
        await this.getRoleById(roleId);
        await this.repository.replaceRolePermissions(roleId, permissionIds);
        return this.repository.findRolePermissions(roleId);
    }

    // ─── Aplicações ─────────────────────────────────────────────────────────

    async getApplications() {
        return this.repository.findApplications();
    }

    /** @throws {AppError} 404 */
    async getUserApplications(userId) {
        await this.getUserById(userId);
        return this.repository.findUserApplications(userId);
    }

    async grantApplicationAccess(userId, applicationId) {
        await this.getUserById(userId);
        await this.repository.insertUserApplication(userId, applicationId);
        return this.repository.findUserApplications(userId);
    }

    /** @throws {AppError} 404 */
    async revokeApplicationAccess(userId, applicationId) {
        await this.getUserById(userId);
        await this.repository.deleteUserApplication(userId, applicationId);
        return { revoked: true };
    }
}

module.exports = { AccessUseCases };
