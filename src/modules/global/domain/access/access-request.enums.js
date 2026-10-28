/**
 * @fileoverview Espelho dos ENUMs de `_access_requests` (MySQL `global`) e os
 * códigos de erro do registro de alterações da Gestão de Acessos.
 *
 * Todo valor aqui É o texto gravado na coluna.
 *
 * @module modules/global/domain/access/access-request.enums
 */

/** `_access_requests.type` — uma linha por rota de escrita de `/access/*`. */
const AccessRequestType = Object.freeze({
    CREATE_USER:              'create_user',
    UPDATE_USER:              'update_user',       // PUT  /access/users/:id
    PATCH_USER:               'patch_user',        // PATCH /access/users/:id
    DEACTIVATE_USER:          'deactivate_user',   // DELETE /access/users/:id
    RESET_PASSWORD:           'reset_password',    // não dá para desfazer
    ASSIGN_USER_ROLES:        'assign_user_roles',
    REMOVE_USER_ROLE:         'remove_user_role',
    GRANT_USER_APPLICATION:   'grant_user_application',
    REVOKE_USER_APPLICATION:  'revoke_user_application',
    CREATE_ROLE:              'create_role',
    UPDATE_ROLE:              'update_role',
    DELETE_ROLE:              'delete_role',
    ASSIGN_ROLE_PERMISSIONS:  'assign_role_permissions',
    SET_ROLE_PERMISSIONS:     'set_role_permissions',
    REMOVE_ROLE_PERMISSION:   'remove_role_permission',
    CREATE_PERMISSION:        'create_permission',
    UPDATE_PERMISSION:        'update_permission',
    DELETE_PERMISSION:        'delete_permission',
});

/**
 * `_access_requests.status`. Desde 28/10/2026 a alteração vale na hora e o
 * registro nasce `pending` = aplicada, aguardando revisão.
 */
const AccessRequestStatus = Object.freeze({
    PENDING:  'pending',    // aplicada, aguardando revisão
    APPROVED: 'approved',   // revisada e mantida (ou feita por dono do sistema)
    REJECTED: 'rejected',   // revisada e desfeita
    CANCELED: 'canceled',   // só em registros anteriores a 28/10/2026
});

/** Nome do evento no WebSocket (`{ event, payload }`). */
const ACCESS_WS_EVENT = 'access:request';

/** `payload.action` do `access:request`. */
const AccessRequestAction = Object.freeze({
    REQUESTED: 'requested',   // alteração nova a revisar → revisores
    APPROVED:  'approved',    // → revisores (baixa o contador) e o autor
    REJECTED:  'rejected',    // desfeita → revisores e o autor
});

/** `code` dos `AppError` — o front decide o comportamento por ele. */
const AccessErrorCode = Object.freeze({
    // 400 — entrada
    InvalidIds:            'ACCESS_INVALID_IDS',
    UnknownRole:           'ACCESS_UNKNOWN_ROLE',
    UnknownApplication:    'ACCESS_UNKNOWN_APPLICATION',
    InvalidRequestStatus:  'ACCESS_INVALID_REQUEST_STATUS',
    InvalidRequestType:    'ACCESS_INVALID_REQUEST_TYPE',
    // 403
    SelfReview:            'ACCESS_REQUEST_SELF_REVIEW',
    SelfTarget:            'ACCESS_REQUEST_SELF_TARGET',
    SelfEdit:              'ACCESS_SELF_EDIT',
    TargetIsOwner:         'ACCESS_TARGET_IS_OWNER',
    OwnerProtected:        'ACCESS_OWNER_PROTECTED',
    ReviewerProtected:     'ACCESS_REVIEWER_PROTECTED',
    // 404
    RequestNotFound:       'ACCESS_REQUEST_NOT_FOUND',
    UserNotFound:          'ACCESS_USER_NOT_FOUND',
    RoleNotFound:          'ACCESS_ROLE_NOT_FOUND',
    PermissionNotFound:    'ACCESS_PERMISSION_NOT_FOUND',
    // 409
    RequestNotPending:     'ACCESS_REQUEST_NOT_PENDING',
    UsernameTaken:         'ACCESS_USERNAME_TAKEN',
    // 500
    MysqlError:            'ACCESS_MYSQL_ERROR',
});

/** Helper para os schemas: `values(AccessRequestStatus)` → `['pending', ...]`. */
const values = (frozenEnum) => Object.values(frozenEnum);

module.exports = {
    AccessRequestType,
    AccessRequestStatus,
    AccessRequestAction,
    ACCESS_WS_EVENT,
    AccessErrorCode,
    values,
};
