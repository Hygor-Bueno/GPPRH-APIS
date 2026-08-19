/**
 * @fileoverview Adapter MySQL — implementa `AccessRepositoryPort`.
 *
 * Erros de violação de unicidade (`ER_DUP_ENTRY`) NÃO são traduzidos aqui —
 * propagam com `.code` intacto pro use-case, que é quem tem o valor original
 * (não normalizado) do payload pra montar a mensagem de erro correta.
 *
 * @module modules/global/infrastructure/access/mysql-access.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { AccessRepositoryPort } = require('../../application/access/ports/access-repository.port');
const {
    sqlGetUsers,
    sqlGetUserById,
    sqlInsertUser,
    sqlUpdateUser,
    sqlPatchUser,
    sqlDeactivateUser,
    sqlGetRoles,
    sqlGetRoleById,
    sqlInsertRole,
    sqlUpdateRole,
    sqlDeleteRole,
    sqlCountUsersByRole,
    sqlGetPermissions,
    sqlGetPermissionById,
    sqlInsertPermission,
    sqlUpdatePermission,
    sqlDeletePermission,
    sqlCountRolesByPermission,
    sqlGetUserRoles,
    sqlInsertUserRole,
    sqlDeleteUserRole,
    sqlGetRolePermissions,
    sqlInsertRolePermission,
    sqlDeleteRolePermission,
    sqlDeleteAllRolePermissions,
    sqlGetApplications,
    sqlGetUserApplications,
    sqlInsertUserApplication,
    sqlDeleteUserApplication,
} = require('../../repositories/mysql/access.queries');

class MysqlAccessRepository extends AccessRepositoryPort {
    /**
     * @private Executa fora de transação — obtém conexão, executa, libera.
     * `ER_DUP_ENTRY` propaga intacto (o use-case precisa do `.code` e do
     * payload original pra montar a mensagem de duplicidade); qualquer outro
     * erro é traduzido para `AppError`.
     */
    async _execute(sql, params = []) {
        const conn = await poolGlobal.getConnection();
        try {
            const [rows] = await conn.execute(sql, params);
            return rows;
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') throw error;
            // O terceiro parâmetro de AppError é um objeto { code, details }.
            throw new AppError('Erro ao acessar o banco de dados', 500, {
                code: error.code || 'MYSQL_ERROR',
                details: error,
            });
        } finally {
            conn.release();
        }
    }

    /** @private Executa múltiplas queries dentro de uma transação, com rollback automático. */
    async _transaction(queries) {
        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();
            for (const { sql, params } of queries) {
                await conn.execute(sql, params);
            }
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw new AppError('Erro na transação', 500, {
                code: err.code || 'MYSQL_ERROR',
                details: err,
            });
        } finally {
            conn.release();
        }
    }

    // ─── Usuários ───────────────────────────────────────────────────────────

    async findUsers(filters) {
        const { sql, params } = sqlGetUsers(filters);
        return this._execute(sql, params);
    }

    async findUserById(id) {
        const rows = await this._execute(sqlGetUserById(), [id]);
        return rows[0] ?? null;
    }

    async insertUser(data, createdBy) {
        const rows = await this._execute(sqlInsertUser(), [
            data.user, data.password, data.name, data.registration, data.branch_code,
            data.ad_status, data.administrator, data.table_protheus, createdBy, createdBy,
        ]);
        return { insertId: rows.insertId };
    }

    async updateUser(payload, updatedBy) {
        await this._execute(sqlUpdateUser(), [
            payload.name, payload.registration, payload.branch_code, payload.ad_status,
            payload.administrator, payload.table_protheus, updatedBy, payload.id,
        ]);
    }

    async patchUser(id, fieldNames, fieldValues, updatedBy) {
        await this._execute(sqlPatchUser(fieldNames), [...fieldValues, updatedBy, id]);
    }

    async deactivateUser(id, updatedBy) {
        await this._execute(sqlDeactivateUser(), [updatedBy, id]);
    }

    // ─── Papéis (Roles) ─────────────────────────────────────────────────────

    async findRoles() {
        return this._execute(sqlGetRoles());
    }

    async findRoleById(id) {
        const rows = await this._execute(sqlGetRoleById(), [id]);
        return rows[0] ?? null;
    }

    async insertRole(data) {
        const rows = await this._execute(sqlInsertRole(), [data.name, data.description]);
        return { insertId: rows.insertId };
    }

    async updateRole(data) {
        await this._execute(sqlUpdateRole(), [data.name, data.description, data.id]);
    }

    async countUsersByRole(roleId) {
        const [row] = await this._execute(sqlCountUsersByRole(), [roleId]);
        return row.total;
    }

    async deleteRole(id) {
        await this._execute(sqlDeleteRole(), [id]);
    }

    // ─── Permissões ─────────────────────────────────────────────────────────

    async findPermissions() {
        return this._execute(sqlGetPermissions());
    }

    async findPermissionById(id) {
        const rows = await this._execute(sqlGetPermissionById(), [id]);
        return rows[0] ?? null;
    }

    async insertPermission(data) {
        const rows = await this._execute(sqlInsertPermission(), [data.code, data.description]);
        return this.findPermissionById(rows.insertId);
    }

    async updatePermission(data) {
        await this._execute(sqlUpdatePermission(), [data.code, data.description, data.id]);
        return this.findPermissionById(data.id);
    }

    async countRolesByPermission(permissionId) {
        const [row] = await this._execute(sqlCountRolesByPermission(), [permissionId]);
        return row.total;
    }

    async deletePermission(id) {
        await this._execute(sqlDeletePermission(), [id]);
    }

    // ─── Vínculos Usuário ↔ Papel ───────────────────────────────────────────

    async findUserRoles(userId) {
        return this._execute(sqlGetUserRoles(), [userId]);
    }

    async insertUserRoles(userId, roleIds) {
        for (const roleId of roleIds) {
            await this._execute(sqlInsertUserRole(), [userId, roleId]);
        }
    }

    async deleteUserRole(userId, roleId) {
        await this._execute(sqlDeleteUserRole(), [userId, roleId]);
    }

    // ─── Vínculos Papel ↔ Permissão ─────────────────────────────────────────

    async findRolePermissions(roleId) {
        return this._execute(sqlGetRolePermissions(), [roleId]);
    }

    async insertRolePermissions(roleId, permissionIds) {
        for (const permId of permissionIds) {
            await this._execute(sqlInsertRolePermission(), [roleId, permId]);
        }
    }

    async deleteRolePermission(roleId, permissionId) {
        await this._execute(sqlDeleteRolePermission(), [roleId, permissionId]);
    }

    async replaceRolePermissions(roleId, permissionIds) {
        const queries = [
            { sql: sqlDeleteAllRolePermissions(), params: [roleId] },
            ...permissionIds.map(permId => ({ sql: sqlInsertRolePermission(), params: [roleId, permId] })),
        ];
        await this._transaction(queries);
    }

    // ─── Aplicações ─────────────────────────────────────────────────────────

    async findApplications() {
        return this._execute(sqlGetApplications());
    }

    async findUserApplications(userId) {
        return this._execute(sqlGetUserApplications(), [userId]);
    }

    async insertUserApplication(userId, applicationId) {
        await this._execute(sqlInsertUserApplication(), [applicationId, userId]);
    }

    async deleteUserApplication(userId, applicationId) {
        await this._execute(sqlDeleteUserApplication(), [userId, applicationId]);
    }
}

module.exports = { MysqlAccessRepository };
