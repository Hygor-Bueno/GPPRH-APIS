/**
 * @fileoverview Queries SQL puras — registro de alterações da Gestão de
 * Acessos (`_access_requests`, banco `global`).
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
    ar.previous_state,
    ar.revert_result,
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

/**
 * Alteração de dono do sistema nasce `approved` (revisada por ele mesmo, na
 * hora); as demais nascem `pending`, sem revisor.
 * Parâmetros: [type, target_user_id, target_role_id, target_permission_id,
 * payload(JSON), previous_state(JSON|null), status, requested_by, reviewed_by,
 * reviewed_by, review_note]
 */
function sqlInsertRequest() {
    return `
        INSERT INTO _access_requests
            (type, target_user_id, target_role_id, target_permission_id, payload, previous_state,
             status, requested_by, reviewed_by, reviewed_at, review_note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, IF(? IS NULL, NULL, NOW()), ?)
    `;
}

/** A alteração falhou ao ser aplicada: o registro não descreve nada. Parâmetros: [id] */
function sqlDeleteRequest() {
    return `DELETE FROM _access_requests WHERE id = ?`;
}

/**
 * Tira o registro de `pending` numa única instrução: com dois revisores clicando ao
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

/** Devolve para `pending` quando desfazer a alteração falhou. Parâmetros: [id] */
function sqlReleaseRequest() {
    return `
        UPDATE _access_requests
        SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, review_note = NULL
        WHERE id = ?
    `;
}

/**
 * O que a alteração criou (usuário, papel, permissão) só tem id depois de
 * aplicada. `null` mantém o que já estava.
 * Parâmetros: [target_user_id, target_role_id, target_permission_id, id]
 */
function sqlSetRequestTargets() {
    return `
        UPDATE _access_requests
        SET target_user_id       = COALESCE(?, target_user_id),
            target_role_id       = COALESCE(?, target_role_id),
            target_permission_id = COALESCE(?, target_permission_id)
        WHERE id = ?
    `;
}

/** O que desfazer a alteração conseguiu (e o que não). Parâmetros: [revert_result(JSON), id] */
function sqlSetRevertResult() {
    return `UPDATE _access_requests SET revert_result = ? WHERE id = ?`;
}

/** Parâmetros: [username] */
function sqlFindUserIdByUsername() {
    return `SELECT id FROM _user WHERE user = ? LIMIT 1`;
}

/** Pendentes por tipo — contador do sino de quem revisa. Sem parâmetros. */
function sqlCountPendingByType() {
    return `
        SELECT type, COUNT(*) AS total
        FROM _access_requests
        WHERE status = 'pending'
        GROUP BY type
    `;
}

/**
 * Quem recebe o aviso de alteração nova: usuários ativos com `SYSTEM_OWNER`
 * ou `ACCESS_APPROVE` (por qualquer papel). Sem parâmetros.
 */
function sqlFindReviewerIds() {
    return `
        SELECT DISTINCT u.id
        FROM _user u
        JOIN _user_roles       ur ON ur.user_id = u.id
        JOIN _role_permissions rp ON rp.role_id = ur.role_id
        JOIN _permissions      p  ON p.id       = rp.permission_id
        WHERE p.code IN ('SYSTEM_OWNER', 'ACCESS_APPROVE')
          AND u.ad_status = 'active'
    `;
}

/**
 * Papéis que têm a permissão — `SYSTEM_OWNER` (intocáveis pela API) ou
 * `ACCESS_APPROVE` (só dono dá ou tira). Parâmetros: [code]
 */
function sqlFindRoleIdsWithPermission() {
    return `
        SELECT DISTINCT rp.role_id AS id
        FROM _role_permissions rp
        JOIN _permissions      p ON p.id = rp.permission_id
        WHERE p.code = ?
    `;
}

/** Parâmetros: [code] */
function sqlFindPermissionIdByCode() {
    return `SELECT id FROM _permissions WHERE code = ? LIMIT 1`;
}

module.exports = {
    sqlCountPendingByType,
    sqlFindReviewerIds,
    sqlFindRoleIdsWithPermission,
    sqlFindPermissionIdByCode,
    sqlListRequests,
    sqlCountRequests,
    sqlGetRequestById,
    sqlInsertRequest,
    sqlDeleteRequest,
    sqlClaimRequest,
    sqlReleaseRequest,
    sqlSetRequestTargets,
    sqlSetRevertResult,
    sqlFindUserIdByUsername,
};
