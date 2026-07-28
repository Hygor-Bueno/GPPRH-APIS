/**
 * @fileoverview Casos de uso — Gestão de Acessos (usuários, papéis, permissões, aplicações).
 * @module modules/global/application/access/access.use-cases
 */

const bcrypt = require('bcryptjs');
const { AppError } = require('../../../../errors/app.error');
const { PATCH_USER_FIELDS } = require('../../repositories/mysql/access.queries');

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
        if (!user) throw new AppError('Usuário não encontrado', 404);
        return user;
    }

    /**
     * Cria um novo usuário com senha hasheada. Se `password` não for informado,
     * usa o padrão `'1234'` (destinado a usuários que autenticam via AD).
     */
    async createUser(payload, createdBy) {
        const rawPassword = payload.password || '1234';
        const hashedPassword = await bcrypt.hash(rawPassword, BCRYPT_ROUNDS);

        let insertId;
        try {
            ({ insertId } = await this.repository.insertUser({
                user: payload.user,
                password: hashedPassword,
                name: payload.name ?? null,
                registration: payload.registration ?? null,
                branch_code: payload.branch_code ?? null,
                ad_status: payload.ad_status ?? 'pending',
                administrator: payload.administrator ?? 0,
                table_protheus: payload.table_protheus ?? null,
            }, createdBy));
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                throw new AppError(`Username '${payload.user}' já está em uso.`, 409);
            }
            throw error;
        }

        return this.getUserById(insertId);
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
        const safeFields = Object.fromEntries(
            Object.entries(fields).filter(([k]) => PATCH_USER_FIELDS[k])
        );

        if (!Object.keys(safeFields).length) {
            throw new AppError('Nenhum campo válido fornecido para atualização.', 400);
        }

        if (safeFields.password) {
            safeFields.password = await bcrypt.hash(safeFields.password, BCRYPT_ROUNDS);
        }

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
        if (!role) throw new AppError('Papel não encontrado', 404);
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

    /** @throws {AppError} 404 / 409 se o novo código já existir */
    async updatePermission(payload) {
        const existing = await this.repository.findPermissionById(payload.id);
        if (!existing) throw new AppError('Permissão não encontrada', 404);

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
        const existing = await this.repository.findPermissionById(id);
        if (!existing) throw new AppError('Permissão não encontrada', 404);

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
