/**
 * @fileoverview Notificação da REPP: quem é avisado e com que conteúdo.
 *
 * | action      | Quando                                              | Para quem                    |
 * |-------------|-----------------------------------------------------|------------------------------|
 * | `canceled`  | outra pessoa cancela                                | criador                      |
 * | `approved`  | pedido aprovado                                     | criador                      |
 * | `rejected`  | pedido recusado                                     | criador                      |
 * | `updated`   | outra pessoa altera a reserva                       | criador                      |
 * | `requested` | reserva vira pendente (pedido novo ou remarcação)   | administradores do espaço    |
 * | `created`   | reserva nova já nasce aprovada (quem criou administra) | administradores do espaço |
 *
 * Quem agiu nunca recebe o próprio aviso. Reserva sem criador (usuário
 * apagado, `created_by` nulo) não gera aviso ao criador.
 *
 * Toda reserva NOVA avisa os administradores do espaço com UM aviso cada:
 * `requested` quando nasce pendente (pede decisão), `created` quando nasce
 * aprovada — nunca os dois para a mesma reserva (15/10/2026).
 *
 * Todo aviso é GRAVADO (`re_notifications`), para todos os destinatários,
 * estejam online ou não — o sino do front vive só na memória. O `repp:event`
 * do WebSocket leva o mesmo `id` da linha, para o front não duplicar.
 *
 * Decisões do Hygor, 08/10/2026.
 *
 * @module modules/global/domain/repp/notification.rules
 */

const { NotificationAction } = require('./repp.enums');

/** Campos do snapshot gravado em `payload` (JSON), na ordem do contrato. */
const PAYLOAD_FIELDS = Object.freeze([
    'space_name', 'booking_date', 'start_time', 'end_time',
    'title', 'requester_name', 'by_name', 'reason', 'previous',
]);

const toId = (value) => (value === null || value === undefined ? null : Number(value));

/**
 * Espaço, data e horário de uma reserva — o `previous` do `updated`.
 * @returns {{space_name: string, booking_date: string, start_time: string, end_time: string}}
 */
function scheduleOf(booking) {
    return {
        space_name: booking.space_name,
        booking_date: booking.booking_date,
        start_time: booking.start_time,
        end_time: booking.end_time,
    };
}

/** Snapshot da reserva como ficou depois da ação. */
function snapshot(booking, actor, { reason = null, previous = null } = {}) {
    return {
        ...scheduleOf(booking),
        title: booking.title ?? null,
        requester_name: booking.requester_name ?? null,
        by_name: actor.name?.trim() || null,
        reason: reason ?? null,
        previous: previous ?? null,
    };
}

/**
 * Aviso ao CRIADOR (canceled/approved/rejected/updated), ou `null` quando
 * quem agiu é o próprio criador ou a reserva não tem criador.
 *
 * @param {object} params
 * @param {object} params.booking  - a reserva como ficou depois da ação.
 * @param {string} params.action   - `NotificationAction`.
 * @param {{id: number, name?: string}} params.actor - `req.user`.
 * @param {?string} [params.reason]   - motivo do cancelamento ou da recusa.
 * @param {?object} [params.previous] - espaço/data/horário antes (só `updated`).
 * @returns {?object}
 */
function buildCreatorNotice({ booking, action, actor, reason = null, previous = null }) {
    const creatorId = toId(booking.created_by);
    const actorId = Number(actor.id);
    if (creatorId === null || creatorId === actorId) return null;

    return {
        user_id: creatorId,
        booking_id: Number(booking.id),
        action,
        by_user_id: actorId,
        payload: snapshot(booking, actor, { reason, previous }),
    };
}

/**
 * Avisos aos administradores do espaço: `requested` (padrão) quando a reserva
 * vira pendente; `created` quando uma reserva nova já nasce aprovada. Quem
 * agiu fica de fora — o administrador que reservou no próprio espaço não
 * recebe o aviso da própria reserva.
 *
 * @param {{booking: object, adminIds: number[], actor: object, previous?: ?object, action?: string}} params
 * @returns {object[]}
 */
function buildRequestNotices({ booking, adminIds, actor, previous = null, action = NotificationAction.Requested }) {
    const actorId = Number(actor.id);
    const recipients = [...new Set(adminIds.map(Number))].filter((id) => id !== actorId);
    const payload = snapshot(booking, actor, { previous });
    return recipients.map((userId) => ({
        user_id: userId,
        booking_id: Number(booking.id),
        action,
        by_user_id: actorId,
        payload: { ...payload },
    }));
}

/** Só os campos conhecidos do snapshot; ausente vira `null`. */
function pickPayload(payload) {
    let source = payload;
    if (typeof source === 'string') {
        try { source = JSON.parse(source); } catch { source = {}; }
    }
    source = source && typeof source === 'object' ? source : {};
    const picked = {};
    for (const field of PAYLOAD_FIELDS) picked[field] = source[field] ?? null;
    // A coluna JSON do MySQL reordena as chaves; o contrato tem ordem fixa.
    if (picked.previous && typeof picked.previous === 'object') picked.previous = scheduleOf(picked.previous);
    return picked;
}

/** O que vai no `repp:event`, a partir do aviso gravado (`id` = da linha). */
function toEventPayload(id, notice) {
    return {
        id: Number(id),
        action: notice.action,
        booking_id: notice.booking_id,
        ...pickPayload(notice.payload),
        by_user_id: notice.by_user_id,
    };
}

/** Linha de `re_notifications` → resposta do GET (mesmo formato do evento + datas). */
function shapeNotification(row) {
    return {
        id: Number(row.id),
        action: row.action,
        booking_id: Number(row.booking_id),
        ...pickPayload(row.payload),
        by_user_id: toId(row.by_user_id),
        created_at: row.created_at,
        read_at: row.read_at,
    };
}

/**
 * `ids` do `PATCH /notifications/read`: lista não vazia de ids positivos.
 * Repetidos são colapsados; o teto protege o `IN (?)`.
 * @returns {number[]|null} `null` quando inválido (quem chama responde 400).
 */
const MAX_READ_IDS = 500;
function normalizeNotificationIds(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_READ_IDS) return null;
    const ids = value.map(Number);
    if (!ids.every((id) => Number.isInteger(id) && id > 0)) return null;
    return [...new Set(ids)];
}

/** Lidas há mais que isto são apagadas. */
const READ_RETENTION_DAYS = 30;

module.exports = {
    PAYLOAD_FIELDS,
    MAX_READ_IDS,
    READ_RETENTION_DAYS,
    scheduleOf,
    buildCreatorNotice,
    buildRequestNotices,
    toEventPayload,
    shapeNotification,
    normalizeNotificationIds,
};
