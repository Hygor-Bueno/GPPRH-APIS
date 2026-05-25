/**
 * @fileoverview Serviço de Gestão de Acessos.
 *
 * Centraliza toda a lógica de negócio para gerenciamento de usuários, papéis (roles),
 * permissões e acessos a aplicações no banco MySQL `global`.
 *
 * Fluxo de conexão: `poolGlobal.getConnection()` → `execute()` → `conn.release()` no `finally`.
 *
 * @module modules/global/services/access.service
 */

const bcrypt        = require('bcryptjs');
const { poolGlobal } = require('../../../config/mysql');
const { AppError }   = require('../../../errors/app.error');

const {
    PATCH_USER_FIELDS,
    sqlGetUsers,
    sqlGetUserById,
    sqlInsertUser,
    sqlUpdateUser,
    sqlUpdateUserPassword,
    sqlPatchUser,
    sqlDeactivateUser,
    sqlGetRoles,
    sqlGetRoleById,
    sqlInsertRole,
    sqlUpdateRole,
    sqlDeleteRole,
    sqlCountUsersByRole,
    sqlGetPermissions,
    sqlInsertPermission,
    sqlUpdatePermission,
    sqlDeletePermission,
    sqlCountRolesByPermission,
    sqlGetUserRoles,
    sqlInsertUserRole,
    sqlDeleteUserRole,
    sqlDeleteAllUserRoles,
    sqlGetRolePermissions,
    sqlInsertRolePermission,
    sqlDeleteRolePermission,
    sqlDeleteAllRolePermissions,
    sqlGetApplications,
    sqlGetUserApplications,
    sqlInsertUserApplication,
    sqlDeleteUserApplication
} = require('../repositories/mysql/access.repository');

/** Custo do hash bcrypt para senhas de usuário. @constant {number} */
const BCRYPT_ROUNDS = 10;

/**
 * Serviço de Gestão de Acessos.
 *
 * Expõe operações CRUD sobre usuários, papéis, permissões e acessos a aplicações.
 * Garante integridade referencial antes de excluir entidades que possuem dependências.
 */
class AccessService {

    // ─── Helpers Internos ─────────────────────────────────────────────────────

    /**
     * Obtém uma conexão do pool, executa a query e libera a conexão.
     *
     * @private
     * @param {string}  sql    - Query SQL com `?` como placeholders.
     * @param {any[]}   params - Valores para os placeholders.
     * @returns {Promise<any[]>} Array de linhas retornadas.
     * @throws {AppError} Em caso de falha na execução.
     */
    async _execute(sql, params = []) {
        let conn;
        try {
            conn = await poolGlobal.getConnection();
            const [rows] = await conn.execute(sql, params);
            return rows;
        } finally {
            if (conn) conn.release();
        }
    }

    /**
     * Executa múltiplas queries dentro de uma transação MySQL.
     * Em caso de erro, realiza ROLLBACK automático.
     *
     * @private
     * @param {Array<{sql: string, params: any[]}>} queries - Lista de queries a executar em sequência.
     * @returns {Promise<void>}
     * @throws {AppError} Se qualquer query falhar.
     */
    async _transaction(queries) {
        let conn;
        try {
            conn = await poolGlobal.getConnection();
            await conn.beginTransaction();
            for (const { sql, params } of queries) {
                await conn.execute(sql, params);
            }
            await conn.commit();
        } catch (err) {
            if (conn) await conn.rollback();
            throw new AppError(err.message || 'Erro na transação', 500, 'MYSQL_ERROR', err);
        } finally {
            if (conn) conn.release();
        }
    }

    // ─── Usuários ─────────────────────────────────────────────────────────────

    /**
     * Retorna usuários com seus papéis agregados, suportando filtros opcionais.
     *
     * @param {Object}  [filters={}]             - Filtros de busca.
     * @param {0|1}     [filters.status]         - 1 = ativo, 0 = inativo.
     * @param {string}  [filters.name]           - Filtro parcial por nome.
     * @param {string}  [filters.registration]   - Matrícula exata.
     * @param {string}  [filters.branch_code]    - Código da filial.
     * @returns {Promise<Object[]>} Lista de usuários.
     * @throws {AppError} Em caso de falha na consulta.
     */
    async getUsers(filters = {}) {
        try {
            const { sql, params } = sqlGetUsers(filters);
            return await this._execute(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao buscar usuários', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Retorna um usuário pelo ID com seus papéis e permissões expandidos.
     *
     * @param {number} id - ID do usuário.
     * @returns {Promise<Object>} Dados completos do usuário.
     * @throws {AppError} 404 se não encontrado.
     * @throws {AppError} 500 em caso de falha.
     */
    async getUserById(id) {
        try {
            const rows = await this._execute(sqlGetUserById(), [id]);
            if (!rows[0]) throw new AppError('Usuário não encontrado', 404);
            return rows[0];
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao buscar usuário', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Cria um novo usuário com senha hasheada.
     *
     * Se `password` não for informado, usa o padrão `'1234'` (destinado a usuários
     * que autenticam via AD e não precisam de senha local).
     *
     * @param {Object}       payload                  - Dados do usuário.
     * @param {string}       payload.user             - Username (login).
     * @param {string}       [payload.password]       - Senha em texto plano (será hasheada).
     * @param {string}       payload.name             - Nome completo.
     * @param {string}       [payload.registration]   - Matrícula.
     * @param {string}       [payload.branch_code]    - Código da filial.
     * @param {0|1}          [payload.status=1]       - Status inicial.
     * @param {0|1}          [payload.administrator=0] - Flag de administrador.
     * @param {string}       [payload.table_protheus] - Tabela Protheus associada.
     * @param {number}       createdBy                - ID do usuário que está criando.
     * @returns {Promise<Object>} Usuário criado (com ID gerado).
     * @throws {AppError} 409 em caso de username duplicado.
     * @throws {AppError} 500 em caso de falha.
     */
    async createUser(payload, createdBy) {
        try {
            const rawPassword = payload.password || '1234';
            const hashedPassword = await bcrypt.hash(rawPassword, BCRYPT_ROUNDS);

            const rows = await this._execute(sqlInsertUser(), [
                payload.user,
                hashedPassword,
                payload.name             ?? null,
                payload.registration     ?? null,
                payload.branch_code      ?? null,
                payload.status           ?? 1,
                payload.administrator    ?? 0,
                payload.table_protheus   ?? null,
                createdBy,
                createdBy
            ]);

            // Retorna o usuário recém-criado com o ID gerado
            return await this.getUserById(rows.insertId);
        } catch (error) {
            if (error instanceof AppError) throw error;
            // Violação de unicidade no campo `user`
            if (error.code === 'ER_DUP_ENTRY') {
                throw new AppError(`Username '${payload.user}' já está em uso.`, 409);
            }
            throw new AppError(error.message || 'Erro ao criar usuário', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Atualiza completamente os dados de um usuário (PUT).
     * Não altera senha nem campos de AD nesta operação.
     *
     * @param {Object}  payload                  - Dados atualizados.
     * @param {number}  payload.id               - ID do usuário.
     * @param {string}  payload.name             - Nome completo.
     * @param {string}  [payload.registration]   - Matrícula.
     * @param {string}  [payload.branch_code]    - Código da filial.
     * @param {0|1}     payload.status           - Status.
     * @param {0|1}     payload.administrator    - Flag administrador.
     * @param {string}  [payload.table_protheus] - Tabela Protheus.
     * @param {number}  updatedBy                - ID do usuário que está editando.
     * @returns {Promise<Object>} Usuário atualizado.
     * @throws {AppError} 404 se não encontrado.
     * @throws {AppError} 500 em caso de falha.
     */
    async updateUser(payload, updatedBy) {
        try {
            await this._execute(sqlUpdateUser(), [
                payload.name             ?? null,
                payload.registration     ?? null,
                payload.branch_code      ?? null,
                payload.status           ?? 1,
                payload.administrator    ?? 0,
                payload.table_protheus   ?? null,
                updatedBy,
                payload.id
            ]);
            return await this.getUserById(payload.id);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao atualizar usuário', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Atualiza parcialmente um usuário (PATCH).
     *
     * Os campos são validados contra `PATCH_USER_FIELDS`. Se `password` estiver entre
     * os campos, é tratada separadamente (hash bcrypt) para evitar que o valor
     * em texto plano entre no UPDATE genérico.
     *
     * @param {number} id         - ID do usuário a atualizar.
     * @param {Object} fields     - Campos a alterar com seus novos valores.
     * @param {number} updatedBy  - ID do usuário que está editando.
     * @returns {Promise<Object>} Usuário após atualização parcial.
     * @throws {AppError} 400 se nenhum campo válido for enviado.
     * @throws {AppError} 404 se o usuário não for encontrado.
     * @throws {AppError} 500 em caso de falha.
     */
    async patchUser(id, fields, updatedBy) {
        // Whitelist: mantém apenas campos reconhecidos
        const safeFields = Object.fromEntries(
            Object.entries(fields).filter(([k]) => PATCH_USER_FIELDS[k])
        );

        if (!Object.keys(safeFields).length) {
            throw new AppError('Nenhum campo válido fornecido para atualização.', 400);
        }

        try {
            // Trata password separadamente para hash
            if (safeFields.password) {
                safeFields.password = await bcrypt.hash(safeFields.password, BCRYPT_ROUNDS);
            }

            const fieldNames  = Object.keys(safeFields);
            const fieldValues = Object.values(safeFields);

            await this._execute(
                sqlPatchUser(fieldNames),
                [...fieldValues, updatedBy, id]
            );

            return await this.getUserById(id);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao atualizar usuário', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Desativa um usuário (soft-delete: `status = 0`).
     * O registro permanece no banco para auditoria e histórico.
     *
     * @param {number} id        - ID do usuário a desativar.
     * @param {number} updatedBy - ID do usuário que está realizando a ação.
     * @returns {Promise<{deactivated: true}>}
     * @throws {AppError} 404 se o usuário não existir.
     * @throws {AppError} 500 em caso de falha.
     */
    async deactivateUser(id, updatedBy) {
        try {
            // Verifica existência
            await this.getUserById(id);
            await this._execute(sqlDeactivateUser(), [updatedBy, id]);
            return { deactivated: true };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao desativar usuário', 500, 'MYSQL_ERROR', error);
        }
    }

    // ─── Papéis (Roles) ───────────────────────────────────────────────────────

    /**
     * Retorna todos os papéis com suas permissões agregadas.
     *
     * @returns {Promise<Object[]>} Lista de papéis.
     * @throws {AppError} Em caso de falha.
     */
    async getRoles() {
        try {
            return await this._execute(sqlGetRoles());
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao buscar papéis', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Retorna um papel pelo ID com suas permissões.
     *
     * @param {number} id - ID do papel.
     * @returns {Promise<Object>} Dados do papel.
     * @throws {AppError} 404 se não encontrado.
     */
    async getRoleById(id) {
        try {
            const rows = await this._execute(sqlGetRoleById(), [id]);
            if (!rows[0]) throw new AppError('Papel não encontrado', 404);
            return rows[0];
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao buscar papel', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Cria um novo papel.
     *
     * @param {Object} payload              - Dados do papel.
     * @param {string} payload.name         - Nome único do papel (ex.: `'GESTOR_RH'`).
     * @param {string} [payload.description] - Descrição legível.
     * @returns {Promise<Object>} Papel criado.
     * @throws {AppError} 409 se o nome já estiver em uso.
     * @throws {AppError} 500 em caso de falha.
     */
    async createRole(payload) {
        try {
            const rows = await this._execute(sqlInsertRole(), [
                payload.name.toUpperCase(),
                payload.description ?? null
            ]);
            return await this.getRoleById(rows.insertId);
        } catch (error) {
            if (error instanceof AppError) throw error;
            if (error.code === 'ER_DUP_ENTRY') {
                throw new AppError(`Papel '${payload.name}' já existe.`, 409);
            }
            throw new AppError(error.message || 'Erro ao criar papel', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Atualiza nome e descrição de um papel.
     *
     * @param {Object} payload              - Dados atualizados.
     * @param {number} payload.id           - ID do papel.
     * @param {string} payload.name         - Novo nome.
     * @param {string} [payload.description] - Nova descrição.
     * @returns {Promise<Object>} Papel atualizado.
     * @throws {AppError} 404 se não encontrado.
     * @throws {AppError} 409 se o novo nome já estiver em uso.
     */
    async updateRole(payload) {
        try {
            await this.getRoleById(payload.id);
            await this._execute(sqlUpdateRole(), [
                payload.name.toUpperCase(),
                payload.description ?? null,
                payload.id
            ]);
            return await this.getRoleById(payload.id);
        } catch (error) {
            if (error instanceof AppError) throw error;
            if (error.code === 'ER_DUP_ENTRY') {
                throw new AppError(`Papel '${payload.name}' já existe.`, 409);
            }
            throw new AppError(error.message || 'Erro ao atualizar papel', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Remove um papel, desde que não haja usuários vinculados a ele.
     *
     * @param {number} id - ID do papel a remover.
     * @returns {Promise<{deleted: true}>}
     * @throws {AppError} 404 se não encontrado.
     * @throws {AppError} 409 se houver usuários com este papel.
     */
    async deleteRole(id) {
        try {
            await this.getRoleById(id);

            const [countRow] = await this._execute(sqlCountUsersByRole(), [id]);
            if (countRow.total > 0) {
                throw new AppError(
                    `Não é possível excluir: ${countRow.total} usuário(s) possuem este papel.`, 409
                );
            }

            await this._execute(sqlDeleteRole(), [id]);
            return { deleted: true };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao excluir papel', 500, 'MYSQL_ERROR', error);
        }
    }

    // ─── Permissões ───────────────────────────────────────────────────────────

    /**
     * Retorna todas as permissões cadastradas.
     *
     * @returns {Promise<Object[]>} Lista de permissões.
     * @throws {AppError} Em caso de falha.
     */
    async getPermissions() {
        try {
            return await this._execute(sqlGetPermissions());
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao buscar permissões', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Cria uma nova permissão.
     *
     * @param {Object} payload              - Dados da permissão.
     * @param {string} payload.code         - Código único (ex.: `'MANAGE_PAYEE'`).
     * @param {string} [payload.description] - Descrição legível.
     * @returns {Promise<Object>} Permissão criada.
     * @throws {AppError} 409 se o código já existir.
     */
    async createPermission(payload) {
        try {
            const rows = await this._execute(sqlInsertPermission(), [
                payload.code.toUpperCase(),
                payload.description ?? null
            ]);
            const perms = await this._execute(
                `SELECT id, code, description FROM _permissions WHERE id = ?`,
                [rows.insertId]
            );
            return perms[0];
        } catch (error) {
            if (error instanceof AppError) throw error;
            if (error.code === 'ER_DUP_ENTRY') {
                throw new AppError(`Permissão '${payload.code}' já existe.`, 409);
            }
            throw new AppError(error.message || 'Erro ao criar permissão', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Atualiza código e descrição de uma permissão.
     *
     * @param {Object} payload              - Dados atualizados.
     * @param {number} payload.id           - ID da permissão.
     * @param {string} payload.code         - Novo código.
     * @param {string} [payload.description] - Nova descrição.
     * @returns {Promise<Object>} Permissão atualizada.
     * @throws {AppError} 404 se não encontrada.
     * @throws {AppError} 409 se o novo código já existir.
     */
    async updatePermission(payload) {
        try {
            const check = await this._execute(
                `SELECT id FROM _permissions WHERE id = ?`, [payload.id]
            );
            if (!check[0]) throw new AppError('Permissão não encontrada', 404);

            await this._execute(sqlUpdatePermission(), [
                payload.code.toUpperCase(),
                payload.description ?? null,
                payload.id
            ]);

            const rows = await this._execute(
                `SELECT id, code, description FROM _permissions WHERE id = ?`, [payload.id]
            );
            return rows[0];
        } catch (error) {
            if (error instanceof AppError) throw error;
            if (error.code === 'ER_DUP_ENTRY') {
                throw new AppError(`Permissão '${payload.code}' já existe.`, 409);
            }
            throw new AppError(error.message || 'Erro ao atualizar permissão', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Remove uma permissão, desde que não esteja associada a nenhum papel.
     *
     * @param {number} id - ID da permissão.
     * @returns {Promise<{deleted: true}>}
     * @throws {AppError} 404 se não encontrada.
     * @throws {AppError} 409 se estiver em uso por algum papel.
     */
    async deletePermission(id) {
        try {
            const check = await this._execute(
                `SELECT id FROM _permissions WHERE id = ?`, [id]
            );
            if (!check[0]) throw new AppError('Permissão não encontrada', 404);

            const [countRow] = await this._execute(sqlCountRolesByPermission(), [id]);
            if (countRow.total > 0) {
                throw new AppError(
                    `Não é possível excluir: ${countRow.total} papel(éis) utilizam esta permissão.`, 409
                );
            }

            await this._execute(sqlDeletePermission(), [id]);
            return { deleted: true };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao excluir permissão', 500, 'MYSQL_ERROR', error);
        }
    }

    // ─── Vínculos Usuário ↔ Papel ─────────────────────────────────────────────

    /**
     * Retorna os papéis de um usuário.
     *
     * @param {number} userId - ID do usuário.
     * @returns {Promise<Object[]>} Lista de papéis do usuário.
     */
    async getUserRoles(userId) {
        try {
            await this.getUserById(userId);
            return await this._execute(sqlGetUserRoles(), [userId]);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao buscar papéis do usuário', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Associa um ou mais papéis a um usuário.
     * Usa `INSERT IGNORE` — papéis já vinculados são silenciosamente ignorados.
     *
     * @param {number}   userId   - ID do usuário.
     * @param {number[]} roleIds  - Lista de IDs de papéis a associar.
     * @returns {Promise<Object[]>} Lista atualizada de papéis do usuário.
     * @throws {AppError} 404 se o usuário não existir.
     */
    async assignRolesToUser(userId, roleIds) {
        try {
            await this.getUserById(userId);
            for (const roleId of roleIds) {
                await this._execute(sqlInsertUserRole(), [userId, roleId]);
            }
            return await this._execute(sqlGetUserRoles(), [userId]);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao associar papéis ao usuário', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Desassocia um papel de um usuário.
     *
     * @param {number} userId - ID do usuário.
     * @param {number} roleId - ID do papel a remover.
     * @returns {Promise<{removed: true}>}
     * @throws {AppError} 404 se o usuário não existir.
     */
    async removeRoleFromUser(userId, roleId) {
        try {
            await this.getUserById(userId);
            await this._execute(sqlDeleteUserRole(), [userId, roleId]);
            return { removed: true };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao remover papel do usuário', 500, 'MYSQL_ERROR', error);
        }
    }

    // ─── Vínculos Papel ↔ Permissão ───────────────────────────────────────────

    /**
     * Retorna as permissões de um papel.
     *
     * @param {number} roleId - ID do papel.
     * @returns {Promise<Object[]>} Lista de permissões do papel.
     */
    async getRolePermissions(roleId) {
        try {
            await this.getRoleById(roleId);
            return await this._execute(sqlGetRolePermissions(), [roleId]);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao buscar permissões do papel', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Associa uma ou mais permissões a um papel.
     * Usa `INSERT IGNORE` — permissões já vinculadas são silenciosamente ignoradas.
     *
     * @param {number}   roleId        - ID do papel.
     * @param {number[]} permissionIds - Lista de IDs de permissões a associar.
     * @returns {Promise<Object[]>} Lista atualizada de permissões do papel.
     * @throws {AppError} 404 se o papel não existir.
     */
    async assignPermissionsToRole(roleId, permissionIds) {
        try {
            await this.getRoleById(roleId);
            for (const permId of permissionIds) {
                await this._execute(sqlInsertRolePermission(), [roleId, permId]);
            }
            return await this._execute(sqlGetRolePermissions(), [roleId]);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao associar permissões ao papel', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Desassocia uma permissão de um papel.
     *
     * @param {number} roleId        - ID do papel.
     * @param {number} permissionId  - ID da permissão a remover.
     * @returns {Promise<{removed: true}>}
     * @throws {AppError} 404 se o papel não existir.
     */
    async removePermissionFromRole(roleId, permissionId) {
        try {
            await this.getRoleById(roleId);
            await this._execute(sqlDeleteRolePermission(), [roleId, permissionId]);
            return { removed: true };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao remover permissão do papel', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Substitui completamente as permissões de um papel (operação atômica em transação).
     * Remove todas as permissões existentes e insere as novas.
     *
     * @param {number}   roleId        - ID do papel.
     * @param {number[]} permissionIds - Nova lista de IDs de permissões.
     * @returns {Promise<Object[]>} Lista atualizada de permissões do papel.
     * @throws {AppError} 404 se o papel não existir.
     */
    async setRolePermissions(roleId, permissionIds) {
        try {
            await this.getRoleById(roleId);

            const queries = [
                { sql: sqlDeleteAllRolePermissions(), params: [roleId] },
                ...permissionIds.map(permId => ({
                    sql: sqlInsertRolePermission(), params: [roleId, permId]
                }))
            ];

            await this._transaction(queries);
            return await this._execute(sqlGetRolePermissions(), [roleId]);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao definir permissões do papel', 500, 'MYSQL_ERROR', error);
        }
    }

    // ─── Aplicações ───────────────────────────────────────────────────────────

    /**
     * Retorna todas as aplicações cadastradas no sistema.
     *
     * @returns {Promise<Object[]>} Lista de aplicações.
     */
    async getApplications() {
        try {
            return await this._execute(sqlGetApplications());
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao buscar aplicações', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Retorna as aplicações às quais o usuário tem acesso.
     *
     * @param {number} userId - ID do usuário.
     * @returns {Promise<Object[]>} Lista de aplicações com data de sessão.
     * @throws {AppError} 404 se o usuário não existir.
     */
    async getUserApplications(userId) {
        try {
            await this.getUserById(userId);
            return await this._execute(sqlGetUserApplications(), [userId]);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao buscar aplicações do usuário', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Concede acesso de um usuário a uma aplicação.
     * Usa `INSERT IGNORE` — acesso já existente é silenciosamente ignorado.
     *
     * @param {number} userId        - ID do usuário.
     * @param {number} applicationId - ID da aplicação.
     * @returns {Promise<Object[]>} Lista atualizada de aplicações do usuário.
     * @throws {AppError} 404 se o usuário não existir.
     */
    async grantApplicationAccess(userId, applicationId) {
        try {
            await this.getUserById(userId);
            await this._execute(sqlInsertUserApplication(), [applicationId, userId]);
            return await this._execute(sqlGetUserApplications(), [userId]);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao conceder acesso à aplicação', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Revoga o acesso de um usuário a uma aplicação.
     *
     * @param {number} userId        - ID do usuário.
     * @param {number} applicationId - ID da aplicação.
     * @returns {Promise<{revoked: true}>}
     * @throws {AppError} 404 se o usuário não existir.
     */
    async revokeApplicationAccess(userId, applicationId) {
        try {
            await this.getUserById(userId);
            await this._execute(sqlDeleteUserApplication(), [userId, applicationId]);
            return { revoked: true };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao revogar acesso à aplicação', 500, 'MYSQL_ERROR', error);
        }
    }
}

module.exports = { AccessService };
