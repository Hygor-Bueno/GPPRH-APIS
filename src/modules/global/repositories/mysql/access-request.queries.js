/**
 * @fileoverview Queries SQL puras — fila de aprovação da Gestão de Acessos
 * (`_access_requests`, banco `global`).
 *
 * @module modules/global/repositories/mysql/access-request.queries
 */

const { localDateTime } = require('./mysql-datetime.sql');

const REQUEST_COLUMNS = `
    ar.id,
    ar.type,
    ar.status,
    ar.target_user_id,
    tu.user                                      AS target_user_login,
    UPPER(TRIM(tu.name))                         AS target_user_name,
    ar.target_role_id,
    tr.name                                      AS target_role_name,
    ar.target_permission_id,
    tp.code                                      AS target_permission_code,
    ar.payload,
    ar.requested_by,
    UPPER(TRIM(rq.name))                         AS requested_by_name,
    ${localDateTime('ar.requested_at')},
    ar.reviewed_by,
    UPPER(TRIM(rv.name))                         AS reviewed_by_name,
    ${localDateTime('ar.reviewed_at')},
    ar.review_note
`;

const REQUEST_JOINS = `
    FROM _access_requests ar
    LEFT JOIN _user        tu ON tu.id = ar.target_user_id
    LEFT JOIN _roles       tr ON tr.id = ar.target_role_id
    LEFT JOIN _permissions tp ON tp.id = ar.target_permission_id
    LEFT JOIN _user        rq ON rq.id = ar.requested_by
    LEFT JOIN _user        rv ON rv.id = ar.reviewed_by
`;

/**
 * Filtros opcionais: `null` = sem filtro.
 * Parâmetros (na ordem): [status, status, type, type, requested_by, requested_by,
 * target_user_id, target_user_id]
 */
const FILTER_WHERE = `
    WHERE (? IS NULL OR ar.status         = ?)
      AND (? IS NULL OR ar.type           = ?)
      AND (? IS NULL OR ar.requested_by   = ?)
      AND (? IS NULL OR ar.target_user_id = ?)
`;

/** Parâmetros: [...filtros (8), limit, offset] */
function sqlListRequests() {
    return `SELECT ${REQUEST_COLUMNS} ${REQUEST_JOINS} ${FILTER_WHERE}
            ORDER BY ar.id DESC
            LIMIT ? OFFSET ?`;
}

/** Parâmetros: [...filtros (8)] */
function sqlCountRequests() {
    return `SELECT COUNT(*) AS total FROM _access_requests ar ${FILTER_WHERE}`;
}

/** Parâmetros: [id] */
function sqlGetRequestById() {
    return `SELECT ${REQUEST_COLUMNS} ${REQUEST_JOINS} WHERE ar.id = ?`;
}

/** Parâmetros: [type, target_user_id, target_role_id, target_permission_id, payload(JSON), requested_by] */
function sqlInsertRequest() {
    return `
        INSERT INTO _access_requests
            (type, target_user_id, target_role_id, target_permission_id, payload, requested_by)
        VALUES (?, ?, ?, ?, ?, ?)
    `;
}

/**
 * Tira o pedido de `pending` numa única instrução: com dois donos clicando ao
 * mesmo tempo, só um recebe `affectedRows = 1`.
 * Parâmetros: [status, reviewed_by, review_note, id]
 */
function sqlClaimRequest() {
    return `
        UPDATE _access_requests
        SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_note = ?
        WHERE id = ? AND status = 'pending'
    `;
}

/** Devolve para `pending` quando a aplicação da mudança falhou. Parâmetros: [id] */
function sqlReleaseRequest() {
    return `
        UPDATE _access_requests
        SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, review_note = NULL
        WHERE id = ?
    `;
}

/** Usuário criado por um pedido aprovado. Parâmetros: [target_user_id, id] */
function sqlSetRequestTargetUser() {
    return `UPDATE _access_requests SET target_user_id = ? WHERE id = ?`;
}

/** Parâmetros: [username] */
function sqlFindUserIdByUsername() {
    return `SELECT id FROM _user WHERE user = ? LIMIT 1`;
}

/** Já existe pedido de criação pendente para este login? Parâmetros: [username] */
function sqlFindPendingCreateUser() {
    return `
        SELECT id FROM _access_requests
        WHERE type = 'create_user'
          AND status = 'pending'
          AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.user')) = ?
        LIMIT 1
    `;
}

/** Pendentes por tipo — contador do sino do dono. Sem parâmetros. */
function sqlCountPendingByType() {
    return `
        SELECT type, COUNT(*) AS total
        FROM _access_requests
        WHERE status = 'pending'
        GROUP BY type
    `;
}

/**
 * Quem recebe o aviso de pedido novo: usuários ativos com `SYSTEM_OWNER`
 * (por qualquer papel). Sem parâmetros.
 */
function sqlFindApproverIds() {
    return `
        SELECT DISTINCT u.id
        FROM _user u
        JOIN _user_roles       ur ON ur.user_id = u.id
        JOIN _role_permissions rp ON rp.role_id = ur.role_id
        JOIN _permissions      p  ON p.id       = rp.permission_id
        WHERE p.code = 'SYSTEM_OWNER'
          AND u.ad_status = 'active'
    `;
}

module.exports = {
    sqlCountPendingByType,
    sqlFindApproverIds,
    sqlListRequests,
    sqlCountRequests,
    sqlGetRequestById,
    sqlInsertRequest,
    sqlClaimRequest,
    sqlReleaseRequest,
    sqlSetRequestTargetUser,
    sqlFindUserIdByUsername,
    sqlFindPendingCreateUser,
};
