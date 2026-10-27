/**
 * @fileoverview Espelho dos ENUMs de `_access_requests` (MySQL `global`) e os
 * códigos de erro da fila de aprovação da Gestão de Acessos.
 *
 * Todo valor aqui É o texto gravado na coluna.
 *
 * @module modules/global/domain/access/access-request.enums
 */

/** `_access_requests.type` — uma linha por rota de escrita que passa pela fila. */
const AccessRequestType = Object.freeze({
    CREATE_USER:              'create_user',
    UPDATE_USER:              'update_user',       // PUT  /access/users/:id
    PATCH_USER:               'patch_user',        // PATCH /access/users/:id
    ASSIGN_USER_ROLES:        'assign_user_roles',
    REMOVE_USER_ROLE:         'remove_user_role',
    GRANT_USER_APPLICATION:   'grant_user_application',
    REVOKE_USER_APPLICATION:  'revoke_user_application',
    ASSIGN_ROLE_PERMISSIONS:  'assign_role_permissions',
    SET_ROLE_PERMISSIONS:     'set_role_permissions',
    REMOVE_ROLE_PERMISSION:   'remove_role_permission',
    UPDATE_PERMISSION:        'update_permission',
});

/** `_access_requests.status` */
const AccessRequestStatus = Object.freeze({
    PENDING:  'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    CANCELED: 'canceled',
});

/** Nome do evento no WebSocket (`{ event, payload }`). */
const ACCESS_WS_EVENT = 'access:request';

/** `payload.action` do `access:request`. */
const AccessRequestAction = Object.freeze({
    REQUESTED: 'requested',   // pedido novo → donos
    APPROVED:  'approved',    // → donos (baixa o contador) e quem pediu
    REJECTED:  'rejected',    // → donos e quem pediu
    CANCELED:  'canceled',    // → donos
});

/** `code` dos `AppError` da fila — o front decide o comportamento por ele. */
const AccessErrorCode = Object.freeze({
    // 400 — entrada
    InvalidIds:            'ACCESS_INVALID_IDS',
    UnknownRole:           'ACCESS_UNKNOWN_ROLE',
    UnknownApplication:    'ACCESS_UNKNOWN_APPLICATION',
    InvalidRequestStatus:  'ACCESS_INVALID_REQUEST_STATUS',
    InvalidRequestType:    'ACCESS_INVALID_REQUEST_TYPE',
    // 403
    SelfReview:            'ACCESS_REQUEST_SELF_REVIEW',
    NotRequester:          'ACCESS_REQUEST_NOT_REQUESTER',
    TargetIsOwner:         'ACCESS_TARGET_IS_OWNER',
    // 404
    RequestNotFound:       'ACCESS_REQUEST_NOT_FOUND',
    UserNotFound:          'ACCESS_USER_NOT_FOUND',
    RoleNotFound:          'ACCESS_ROLE_NOT_FOUND',
    PermissionNotFound:    'ACCESS_PERMISSION_NOT_FOUND',
    // 409
    RequestNotPending:     'ACCESS_REQUEST_NOT_PENDING',
    RequestDuplicate:      'ACCESS_REQUEST_DUPLICATE',
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
