/**
 * @fileoverview Repositório MySQL — Gestão de Acessos.
 *
 * Contém todas as queries SQL para gerenciamento de usuários, papéis (roles),
 * permissões e acessos a aplicações no banco `global`.
 *
 * Padrão de retorno: `{ sql: string, params: any[] }` para queries parametrizadas,
 * ou `string` para queries sem parâmetros dinâmicos.
 *
 * @module modules/global/repositories/mysql/access.repository
 */

// ─── Usuários ──────────────────────────────────────────────────────────────────

/**
 * Campos permitidos em PATCH de usuário, com seus tipos de validação.
 * Usado pelo service para whitelist e pelo controller para schema dinâmico.
 * @type {Object.<string, string>}
 */
const PATCH_USER_FIELDS = {
    name:          'string',
    registration:  'string',
    branch_code:   'string',
    status:        'bit',
    administrator: 'bit',
    table_protheus:'string',
    ad_status:     'string',
    password:      'password'   // tipo especial: exige hash bcrypt no service
};

/**
 * Retorna usuários com seus papéis agregados, suportando filtros dinâmicos.
 *
 * @param {Object}  [filters={}]               - Filtros opcionais.
 * @param {0|1}     [filters.status]           - 1 = ativo, 0 = inativo.
 * @param {string}  [filters.name]             - Filtro parcial por nome (LIKE).
 * @param {string}  [filters.registration]     - Matrícula exata.
 * @param {string}  [filters.branch_code]      - Código de filial exato.
 * @returns {{ sql: string, params: any[] }}
 */
function sqlGetUsers(filters = {}) {
    let sql = `
        SELECT
            u.id,
            u.user,
            u.name,
            u.registration,
            u.branch_code,
            u.status,
            u.administrator,
            u.ad_guid,
            u.ad_status,
            u.table_protheus,
            u.created_at,
            u.updated_at,
            GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ',') AS roles
        FROM _user u
        LEFT JOIN _user_roles  ur ON ur.user_id = u.id
        LEFT JOIN _roles       r  ON r.id       = ur.role_id
        WHERE 1=1
    `;
    const params = [];

    if (filters.status !== undefined) {
        sql += ` AND u.status = ?`;
        params.push(Number(filters.status));
    }
    if (filters.name) {
        sql += ` AND u.name LIKE ?`;
        params.push(`%${filters.name}%`);
    }
    if (filters.registration) {
        sql += ` AND u.registration = ?`;
        params.push(filters.registration);
    }
    if (filters.branch_code) {
        sql += ` AND u.branch_code = ?`;
        params.push(filters.branch_code);
    }

    sql += ` GROUP BY u.id ORDER BY u.name`;
    return { sql, params };
}

/**
 * Retorna um usuário pelo ID com seus papéis e permissões expandidos.
 *
 * @returns {string} SQL com `?` para `[id]`.
 */
function sqlGetUserById() {
    return `
        SELECT
            u.id,
            u.user,
            u.name,
            u.registration,
            u.branch_code,
            u.status,
            u.administrator,
            u.ad_guid,
            u.ad_status,
            u.table_protheus,
            u.created_at,
            u.updated_at,
            GROUP_CONCAT(DISTINCT r.name  ORDER BY r.name  SEPARATOR ',') AS roles,
            GROUP_CONCAT(DISTINCT p.code  ORDER BY p.code  SEPARATOR ',') AS permissions
        FROM _user u
        LEFT JOIN _user_roles       ur ON ur.user_id      = u.id
        LEFT JOIN _roles            r  ON r.id            = ur.role_id
        LEFT JOIN _role_permissions rp ON rp.role_id      = r.id
        LEFT JOIN _permissions      p  ON p.id            = rp.permission_id
        WHERE u.id = ?
        GROUP BY u.id
    `;
}

/**
 * Insere um novo usuário.
 * Parâmetros: `[user, password, name, registration, branch_code, status, administrator, table_protheus, created_by, updated_by]`
 *
 * @returns {string}
 */
function sqlInsertUser() {
    return `
        INSERT INTO _user
            (user, password, name, registration, branch_code, status, administrator, table_protheus, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
}

/**
 * Atualiza todos os campos editáveis de um usuário (PUT).
 * Parâmetros: `[name, registration, branch_code, status, administrator, table_protheus, updated_by, id]`
 *
 * @returns {string}
 */
function sqlUpdateUser() {
    return `
        UPDATE _user
        SET
            name           = ?,
            registration   = ?,
            branch_code    = ?,
            status         = ?,
            administrator  = ?,
            table_protheus = ?,
            updated_by     = ?
        WHERE id = ?
    `;
}

/**
 * Atualiza a senha de um usuário.
 * Parâmetros: `[password_hash, updated_by, id]`
 *
 * @returns {string}
 */
function sqlUpdateUserPassword() {
    return `UPDATE _user SET password = ?, updated_by = ? WHERE id = ?`;
}

/**
 * Constrói um UPDATE dinâmico para PATCH de usuário.
 * Parâmetros na ordem: `[...fieldValues, updated_by, id]`
 *
 * @param {string[]} fieldNames - Lista de campos a atualizar (whitelist via `PATCH_USER_FIELDS`).
 * @returns {string}
 */
function sqlPatchUser(fieldNames) {
    const setClauses = fieldNames.map(f => `${f} = ?`).join(', ');
    return `UPDATE _user SET ${setClauses}, updated_by = ? WHERE id = ?`;
}

/**
 * Desativa um usuário (soft-delete: `status = 0`).
 * Parâmetros: `[updated_by, id]`
 *
 * @returns {string}
 */
function sqlDeactivateUser() {
    return `UPDATE _user SET status = 0, updated_by = ? WHERE id = ?`;
}

// ─── Papéis (Roles) ────────────────────────────────────────────────────────────

/**
 * Retorna todos os papéis com suas permissões agregadas.
 *
 * @returns {string}
 */
function sqlGetRoles() {
    return `
        SELECT
            r.id,
            r.name,
            r.description,
            GROUP_CONCAT(DISTINCT p.code ORDER BY p.code SEPARATOR ',') AS permissions
        FROM _roles r
        LEFT JOIN _role_permissions rp ON rp.role_id  = r.id
        LEFT JOIN _permissions      p  ON p.id        = rp.permission_id
        GROUP BY r.id
        ORDER BY r.name
    `;
}

/**
 * Retorna um papel pelo ID com suas permissões.
 * Parâmetros: `[id]`
 *
 * @returns {string}
 */
function sqlGetRoleById() {
    return `
        SELECT
            r.id,
            r.name,
            r.description,
            GROUP_CONCAT(DISTINCT p.code ORDER BY p.code SEPARATOR ',') AS permissions
        FROM _roles r
        LEFT JOIN _role_permissions rp ON rp.role_id = r.id
        LEFT JOIN _permissions      p  ON p.id       = rp.permission_id
        WHERE r.id = ?
        GROUP BY r.id
    `;
}

/**
 * Insere um novo papel.
 * Parâmetros: `[name, description]`
 *
 * @returns {string}
 */
function sqlInsertRole() {
    return `INSERT INTO _roles (name, description) VALUES (?, ?)`;
}

/**
 * Atualiza nome e descrição de um papel.
 * Parâmetros: `[name, description, id]`
 *
 * @returns {string}
 */
function sqlUpdateRole() {
    return `UPDATE _roles SET name = ?, description = ? WHERE id = ?`;
}

/**
 * Remove um papel.
 * Parâmetros: `[id]`
 *
 * @returns {string}
 */
function sqlDeleteRole() {
    return `DELETE FROM _roles WHERE id = ?`;
}

/**
 * Conta quantos usuários possuem o papel especificado.
 * Parâmetros: `[role_id]` — usado antes de deletar para verificar dependências.
 *
 * @returns {string}
 */
function sqlCountUsersByRole() {
    return `SELECT COUNT(*) AS total FROM _user_roles WHERE role_id = ?`;
}

// ─── Permissões ────────────────────────────────────────────────────────────────

/**
 * Retorna todas as permissões cadastradas.
 *
 * @returns {string}
 */
function sqlGetPermissions() {
    return `SELECT id, code, description FROM _permissions ORDER BY code`;
}

/**
 * Insere uma nova permissão.
 * Parâmetros: `[code, description]`
 *
 * @returns {string}
 */
function sqlInsertPermission() {
    return `INSERT INTO _permissions (code, description) VALUES (?, ?)`;
}

/**
 * Atualiza código e descrição de uma permissão.
 * Parâmetros: `[code, description, id]`
 *
 * @returns {string}
 */
function sqlUpdatePermission() {
    return `UPDATE _permissions SET code = ?, description = ? WHERE id = ?`;
}

/**
 * Remove uma permissão.
 * Parâmetros: `[id]`
 *
 * @returns {string}
 */
function sqlDeletePermission() {
    return `DELETE FROM _permissions WHERE id = ?`;
}

/**
 * Conta quantos papéis utilizam a permissão especificada.
 * Parâmetros: `[permission_id]` — usado antes de deletar para verificar dependências.
 *
 * @returns {string}
 */
function sqlCountRolesByPermission() {
    return `SELECT COUNT(*) AS total FROM _role_permissions WHERE permission_id = ?`;
}

// ─── Vínculos Usuário ↔ Papel ──────────────────────────────────────────────────

/**
 * Retorna os papéis de um usuário.
 * Parâmetros: `[user_id]`
 *
 * @returns {string}
 */
function sqlGetUserRoles() {
    return `
        SELECT r.id, r.name, r.description
        FROM _user_roles ur
        JOIN _roles r ON r.id = ur.role_id
        WHERE ur.user_id = ?
        ORDER BY r.name
    `;
}

/**
 * Associa um papel a um usuário (ignora se já existir).
 * Parâmetros: `[user_id, role_id]`
 *
 * @returns {string}
 */
function sqlInsertUserRole() {
    return `INSERT IGNORE INTO _user_roles (user_id, role_id) VALUES (?, ?)`;
}

/**
 * Desassocia um papel de um usuário.
 * Parâmetros: `[user_id, role_id]`
 *
 * @returns {string}
 */
function sqlDeleteUserRole() {
    return `DELETE FROM _user_roles WHERE user_id = ? AND role_id = ?`;
}

/**
 * Remove todos os papéis de um usuário (usado no PUT para reconfigurar roles).
 * Parâmetros: `[user_id]`
 *
 * @returns {string}
 */
function sqlDeleteAllUserRoles() {
    return `DELETE FROM _user_roles WHERE user_id = ?`;
}

// ─── Vínculos Papel ↔ Permissão ────────────────────────────────────────────────

/**
 * Retorna as permissões de um papel.
 * Parâmetros: `[role_id]`
 *
 * @returns {string}
 */
function sqlGetRolePermissions() {
    return `
        SELECT p.id, p.code, p.description
        FROM _role_permissions rp
        JOIN _permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = ?
        ORDER BY p.code
    `;
}

/**
 * Associa uma permissão a um papel (ignora se já existir).
 * Parâmetros: `[role_id, permission_id]`
 *
 * @returns {string}
 */
function sqlInsertRolePermission() {
    return `INSERT IGNORE INTO _role_permissions (role_id, permission_id) VALUES (?, ?)`;
}

/**
 * Desassocia uma permissão de um papel.
 * Parâmetros: `[role_id, permission_id]`
 *
 * @returns {string}
 */
function sqlDeleteRolePermission() {
    return `DELETE FROM _role_permissions WHERE role_id = ? AND permission_id = ?`;
}

/**
 * Remove todas as permissões de um papel (usado no PUT para reconfigurar).
 * Parâmetros: `[role_id]`
 *
 * @returns {string}
 */
function sqlDeleteAllRolePermissions() {
    return `DELETE FROM _role_permissions WHERE role_id = ?`;
}

// ─── Aplicações ────────────────────────────────────────────────────────────────

/**
 * Retorna todas as aplicações cadastradas.
 *
 * @returns {string}
 */
function sqlGetApplications() {
    return `
        SELECT id, description, full_description, version
        FROM _application
        ORDER BY description
    `;
}

/**
 * Retorna as aplicações às quais o usuário tem acesso.
 * Parâmetros: `[user_id]`
 *
 * @returns {string}
 */
function sqlGetUserApplications() {
    return `
        SELECT
            a.id,
            a.description,
            a.full_description,
            a.version,
            aa.session_date,
            aa.expiration_date
        FROM _application_access aa
        JOIN _application a ON a.id = aa.application_id
        WHERE aa.user_id = ?
        ORDER BY a.description
    `;
}

/**
 * Concede acesso de um usuário a uma aplicação (ignora se já existir).
 * Parâmetros: `[application_id, user_id]`
 *
 * @returns {string}
 */
function sqlInsertUserApplication() {
    return `INSERT IGNORE INTO _application_access (application_id, user_id) VALUES (?, ?)`;
}

/**
 * Revoga o acesso de um usuário a uma aplicação.
 * Parâmetros: `[user_id, application_id]`
 *
 * @returns {string}
 */
function sqlDeleteUserApplication() {
    return `DELETE FROM _application_access WHERE user_id = ? AND application_id = ?`;
}

module.exports = {
    // Usuários
    PATCH_USER_FIELDS,
    sqlGetUsers,
    sqlGetUserById,
    sqlInsertUser,
    sqlUpdateUser,
    sqlUpdateUserPassword,
    sqlPatchUser,
    sqlDeactivateUser,
    // Roles
    sqlGetRoles,
    sqlGetRoleById,
    sqlInsertRole,
    sqlUpdateRole,
    sqlDeleteRole,
    sqlCountUsersByRole,
    // Permissões
    sqlGetPermissions,
    sqlInsertPermission,
    sqlUpdatePermission,
    sqlDeletePermission,
    sqlCountRolesByPermission,
    // Vínculos usuário ↔ papel
    sqlGetUserRoles,
    sqlInsertUserRole,
    sqlDeleteUserRole,
    sqlDeleteAllUserRoles,
    // Vínculos papel ↔ permissão
    sqlGetRolePermissions,
    sqlInsertRolePermission,
    sqlDeleteRolePermission,
    sqlDeleteAllRolePermissions,
    // Aplicações
    sqlGetApplications,
    sqlGetUserApplications,
    sqlInsertUserApplication,
    sqlDeleteUserApplication
};
