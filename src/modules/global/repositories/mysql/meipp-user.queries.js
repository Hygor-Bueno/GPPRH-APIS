/**
 * @fileoverview Consultas SQL puras para `meipp_users`.
 *
 * ─── Por que não há query de senha aqui ──────────────────────────────────────
 * `meipp_users` **não** é um cadastro de identidade paralelo. Quem autentica o
 * painel continua sendo a sessão por cookie do módulo global (ver `CLAUDE.md`);
 * esta tabela só diz **qual papel** (`admin`/`editor`/`viewer`) um usuário já
 * autenticado tem dentro do meipp, e serve de destino para as FKs de autoria
 * (`meipp_media.uploaded_by`, `meipp_playlists.created_by`, etc.).
 *
 * O vínculo é a coluna `global_user_id` (acrescentada ao schema original — ver
 * `GIPP-SQL/meipp-deploy.sql`). `password_hash` fica NULL: existe no DDL para o
 * cenário de operação isolada, e não é lido por nenhuma query deste módulo.
 *
 * @module modules/global/repositories/mysql/meipp-user.queries
 */

const COLUMNS = `id, global_user_id, name, email, role, active, created_at, updated_at`;

const SQL_LIST_USERS = `
    SELECT ${COLUMNS}
    FROM meipp_users
    WHERE (? IS NULL OR active = ?)
    ORDER BY name
    LIMIT ? OFFSET ?
`;

const SQL_COUNT_USERS = `
    SELECT COUNT(*) AS total
    FROM meipp_users
    WHERE (? IS NULL OR active = ?)
`;

const SQL_GET_USER_BY_ID = `
    SELECT ${COLUMNS} FROM meipp_users WHERE id = ?
`;

/**
 * Resolve o usuário meipp a partir do id da sessão global — é o que o
 * middleware de papel chama em toda requisição do painel.
 *
 * Só devolve usuário ativo: desativar aqui tira o acesso ao módulo sem mexer na
 * conta global da pessoa.
 *
 * Parâmetros: `[global_user_id]`
 */
const SQL_GET_USER_BY_GLOBAL_ID = `
    SELECT ${COLUMNS}
    FROM meipp_users
    WHERE global_user_id = ? AND active = 1
    LIMIT 1
`;

const SQL_INSERT_USER = `
    INSERT INTO meipp_users (global_user_id, name, email, role, active)
    VALUES (?, ?, ?, ?, ?)
`;

const SQL_UPDATE_USER = `
    UPDATE meipp_users
    SET global_user_id = ?, name = ?, email = ?, role = ?, active = ?
    WHERE id = ?
`;

/**
 * Desativação, não remoção: as FKs de autoria são ON DELETE SET NULL, então
 * apagar a linha apagaria junto o "quem subiu esta mídia" de todo o histórico.
 */
const SQL_DEACTIVATE_USER = `
    UPDATE meipp_users SET active = 0 WHERE id = ?
`;

module.exports = {
    SQL_LIST_USERS,
    SQL_COUNT_USERS,
    SQL_GET_USER_BY_ID,
    SQL_GET_USER_BY_GLOBAL_ID,
    SQL_INSERT_USER,
    SQL_UPDATE_USER,
    SQL_DEACTIVATE_USER,
};
