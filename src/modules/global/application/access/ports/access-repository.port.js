/**
 * @fileoverview Porta (contrato) de persistência MySQL — Access.
 * @module modules/global/application/access/ports/access-repository.port
 */

class AccessRepositoryPort {
    // ─── Usuários ───────────────────────────────────────────────────────────
    /** @param {object} filters @returns {Promise<object[]>} */
    findUsers(filters) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<object|null>} */
    findUserById(id) { throw new Error('Not implemented'); }

    /**
     * @param {object} data @param {number} createdBy
     * @returns {Promise<{insertId:number}>}
     * @throws {AppError} 409 se o username já estiver em uso
     */
    insertUser(data, createdBy) { throw new Error('Not implemented'); }

    /** @param {object} payload @param {number} updatedBy */
    updateUser(payload, updatedBy) { throw new Error('Not implemented'); }

    /** @param {number} id @param {string[]} fieldNames @param {any[]} fieldValues @param {number} updatedBy */
    patchUser(id, fieldNames, fieldValues, updatedBy) { throw new Error('Not implemented'); }

    /** @param {number} id @param {number} updatedBy */
    deactivateUser(id, updatedBy) { throw new Error('Not implemented'); }

    // ─── Papéis ─────────────────────────────────────────────────────────────
    findRoles() { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<object|null>} */
    findRoleById(id) { throw new Error('Not implemented'); }

    /**
     * @param {{name:string, description:?string}} data
     * @returns {Promise<{insertId:number}>}
     * @throws {AppError} 409 se o nome já existir
     */
    insertRole(data) { throw new Error('Not implemented'); }

    /**
     * @param {{id:number, name:string, description:?string}} data
     * @throws {AppError} 409 se o novo nome já existir
     */
    updateRole(data) { throw new Error('Not implemented'); }

    /** @param {number} roleId @returns {Promise<number>} */
    countUsersByRole(roleId) { throw new Error('Not implemented'); }

    /** @param {number} id */
    deleteRole(id) { throw new Error('Not implemented'); }

    // ─── Permissões ─────────────────────────────────────────────────────────
    findPermissions() { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<object|null>} */
    findPermissionById(id) { throw new Error('Not implemented'); }

    /**
     * @param {{code:string, description:?string}} data
     * @returns {Promise<object>} permissão criada (id, code, description)
     * @throws {AppError} 409 se o código já existir
     */
    insertPermission(data) { throw new Error('Not implemented'); }

    /**
     * @param {{id:number, code:string, description:?string}} data
     * @returns {Promise<object>} permissão atualizada
     * @throws {AppError} 409 se o novo código já existir
     */
    updatePermission(data) { throw new Error('Not implemented'); }

    /** @param {number} permissionId @returns {Promise<number>} */
    countRolesByPermission(permissionId) { throw new Error('Not implemented'); }

    /** @param {number} id */
    deletePermission(id) { throw new Error('Not implemented'); }

    // ─── Vínculos usuário ↔ papel ───────────────────────────────────────────
    /** @param {number} userId @returns {Promise<object[]>} */
    findUserRoles(userId) { throw new Error('Not implemented'); }

    /** @param {number} userId @param {number[]} roleIds */
    insertUserRoles(userId, roleIds) { throw new Error('Not implemented'); }

    /** @param {number} userId @param {number} roleId */
    deleteUserRole(userId, roleId) { throw new Error('Not implemented'); }

    // ─── Vínculos papel ↔ permissão ─────────────────────────────────────────
    /** @param {number} roleId @returns {Promise<object[]>} */
    findRolePermissions(roleId) { throw new Error('Not implemented'); }

    /** @param {number} roleId @param {number[]} permissionIds */
    insertRolePermissions(roleId, permissionIds) { throw new Error('Not implemented'); }

    /** @param {number} roleId @param {number} permissionId */
    deleteRolePermission(roleId, permissionId) { throw new Error('Not implemented'); }

    /** Substitui atomicamente (transação) todas as permissões de um papel. @param {number} roleId @param {number[]} permissionIds */
    replaceRolePermissions(roleId, permissionIds) { throw new Error('Not implemented'); }

    // ─── Aplicações ─────────────────────────────────────────────────────────
    findApplications() { throw new Error('Not implemented'); }

    /** @param {number} userId @returns {Promise<object[]>} */
    findUserApplications(userId) { throw new Error('Not implemented'); }

    /** @param {number} userId @param {number} applicationId */
    insertUserApplication(userId, applicationId) { throw new Error('Not implemented'); }

    /** @param {number} userId @param {number} applicationId */
    deleteUserApplication(userId, applicationId) { throw new Error('Not implemented'); }
}

module.exports = { AccessRepositoryPort };
