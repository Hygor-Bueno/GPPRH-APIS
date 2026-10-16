/**
 * @fileoverview Enums da suite REPP — Reserva de Espaços Peg Pese.
 *
 * Tabelas `re_*` no MySQL `global` (DDL: `GIPP-SQL/re-reserva-espacos-deploy.sql`).
 *
 * @module modules/global/domain/repp/repp.enums
 */

/**
 * Ciclo de vida da reserva.
 *
 *   pending  → criada por quem não administra o espaço; aguarda decisão.
 *   approved → criada por quem administra (aprovação automática) ou aprovada.
 *   rejected → recusada. Libera o horário.
 *   canceled → cancelada (soft delete). Libera o horário.
 */
const BookingStatus = Object.freeze({
    Pending: 'pending',
    Approved: 'approved',
    Rejected: 'rejected',
    Canceled: 'canceled',
});

/**
 * Estados que OCUPAM o horário. Pendente ocupa de propósito (decisão do
 * Hygor, 08/10/2026): quem pede primeiro segura o horário até a decisão, e
 * quem aprova nunca tem de escolher entre dois pedidos sobrepostos.
 */
const OCCUPYING_STATUSES = Object.freeze([BookingStatus.Pending, BookingStatus.Approved]);

/** Intervalo máximo, em dias corridos e contando as duas pontas, da agenda pública. */
const MAX_RANGE_DAYS = 62;

/**
 * Antecedência de quem NÃO administra o espaço (`booking-window.rules`):
 * início pelo menos 24h depois do pedido e data até o mesmo dia daqui a 2
 * meses. Decisão do Hygor, 15/10/2026.
 */
const MIN_ADVANCE_HOURS = 24;
const MAX_ADVANCE_MONTHS = 2;

/**
 * Tipo de aviso. `requested` e `created` vão aos administradores do espaço;
 * os demais, ao criador da reserva. Ver `notification.rules.js`.
 */
const NotificationAction = Object.freeze({
    Canceled: 'canceled',
    Approved: 'approved',
    Rejected: 'rejected',
    Updated: 'updated',
    Requested: 'requested',
    Created: 'created',
});

/** Nome do evento do WebSocket (mensagem `{ event, payload }`). */
const REPP_WS_EVENT = 'repp:event';

/**
 * `code` de todo `AppError` da suite — sai na resposta de erro ao lado de
 * `message`. O front decide o comportamento por ele (a mensagem muda com
 * revisão de texto, o código não). Nenhum erro da REPP sai como
 * `GENERIC_ERROR`: o que ainda sai assim é o `validate.middleware`
 * compartilhado (formato de campo do corpo).
 */
const ReppErrorCode = Object.freeze({
    // 400 — entrada
    InvalidDate: 'REPP_INVALID_DATE',
    InvalidTime: 'REPP_INVALID_TIME',
    InvalidTimeRange: 'REPP_INVALID_TIME_RANGE',
    InvalidDateRange: 'REPP_INVALID_DATE_RANGE',
    DateRangeTooLong: 'REPP_DATE_RANGE_TOO_LONG',
    InvalidSpaceId: 'REPP_INVALID_SPACE_ID',
    InvalidStatus: 'REPP_INVALID_STATUS',
    InvalidNotificationIds: 'REPP_INVALID_NOTIFICATION_IDS',
    RequiredField: 'REPP_REQUIRED_FIELD',
    FieldTooLong: 'REPP_FIELD_TOO_LONG',
    InvalidOrganizationCode: 'REPP_INVALID_ORGANIZATION_CODE',
    OrganizationUnknown: 'REPP_ORGANIZATION_UNKNOWN',
    CompanyNotFound: 'REPP_COMPANY_NOT_FOUND',
    BranchNotFound: 'REPP_BRANCH_NOT_FOUND',
    CostCenterNotFound: 'REPP_COST_CENTER_NOT_FOUND',
    // 400 — regra de negócio
    BookingInPast: 'REPP_BOOKING_IN_PAST',
    SpaceInactive: 'REPP_SPACE_INACTIVE',
    BookingNotEditable: 'REPP_BOOKING_NOT_EDITABLE',
    BookingAlreadyStarted: 'REPP_BOOKING_ALREADY_STARTED',
    BookingTooSoon: 'REPP_BOOKING_TOO_SOON',
    BookingTooFar: 'REPP_BOOKING_TOO_FAR',
    BookingWeekdayBlocked: 'REPP_BOOKING_WEEKDAY_BLOCKED',
    DateNotBlocked: 'REPP_DATE_NOT_BLOCKED',
    UserInactive: 'REPP_USER_INACTIVE',
    // 403
    BookingForbidden: 'REPP_BOOKING_FORBIDDEN',
    ReviewForbidden: 'REPP_REVIEW_FORBIDDEN',
    NotSpaceAdmin: 'REPP_NOT_SPACE_ADMIN',
    ManageAdminsForbidden: 'REPP_MANAGE_ADMINS_FORBIDDEN',
    // 404
    BookingNotFound: 'REPP_BOOKING_NOT_FOUND',
    SpaceNotFound: 'REPP_SPACE_NOT_FOUND',
    UserNotFound: 'REPP_USER_NOT_FOUND',
    // 409
    BookingConflict: 'REPP_BOOKING_CONFLICT',
    BookingStale: 'REPP_BOOKING_STALE',
    BookingNotPending: 'REPP_BOOKING_NOT_PENDING',
    LastSpaceAdmin: 'REPP_LAST_SPACE_ADMIN',
    // 500
    MysqlError: 'REPP_MYSQL_ERROR',
    ProtheusError: 'REPP_PROTHEUS_ERROR',
});

module.exports = {
    BookingStatus,
    OCCUPYING_STATUSES,
    MAX_RANGE_DAYS,
    MIN_ADVANCE_HOURS,
    MAX_ADVANCE_MONTHS,
    NotificationAction,
    REPP_WS_EVENT,
    ReppErrorCode,
};
