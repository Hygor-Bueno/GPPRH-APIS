/**
 * @fileoverview Forma de saída das reservas — mascarada e completa.
 *
 * ⚠️ A versão mascarada é montada por LISTA DE PERMISSÃO (whitelist), não
 * removendo campos de um objeto completo: um campo novo acrescentado à query
 * de detalhes nunca vaza para quem não pode vê-lo por esquecimento. Os campos
 * sensíveis não saem nem como `null` — a chave não existe.
 *
 * @module modules/global/domain/repp/booking.shaper
 */

const { canManage, canReview, canViewDetails } = require('./booking-access.rules');

/** Os únicos campos que anônimo e logado sem permissão recebem. */
const PUBLIC_FIELDS = Object.freeze([
    'id', 'space_id', 'space_name', 'booking_date', 'start_time', 'end_time', 'status',
]);

/** Reserva mascarada: espaço, data, horário e status. Nenhuma ação disponível. */
function shapeMasked(row) {
    const shaped = {};
    for (const field of PUBLIC_FIELDS) shaped[field] = row[field];
    shaped.space_id = Number(row.space_id);
    shaped.id = Number(row.id);
    shaped.can_view_details = false;
    shaped.can_manage = false;
    shaped.can_review = false;
    return shaped;
}

/** Reserva completa, com as flags calculadas para quem consulta. */
function shapeDetailed(row, viewer, now) {
    const toId = (value) => (value === null || value === undefined ? null : Number(value));
    return {
        id: Number(row.id),
        space_id: Number(row.space_id),
        space_name: row.space_name,
        booking_date: row.booking_date,
        start_time: row.start_time,
        end_time: row.end_time,
        status: row.status,
        title: row.title,
        requester_name: row.requester_name,
        company_code: row.company_code,
        company_name: row.company_name,
        branch_code: row.branch_code,
        branch_name: row.branch_name,
        cost_center_code: row.cost_center_code,
        cost_center_description: row.cost_center_description,
        created_by: toId(row.created_by),
        created_by_name: row.created_by_name ?? null,
        created_at: row.created_at,
        updated_by: toId(row.updated_by),
        updated_by_name: row.updated_by_name ?? null,
        updated_at: row.updated_at,
        reviewed_by: toId(row.reviewed_by),
        reviewed_by_name: row.reviewed_by_name ?? null,
        reviewed_at: row.reviewed_at,
        review_note: row.review_note,
        canceled_by: toId(row.canceled_by),
        canceled_by_name: row.canceled_by_name ?? null,
        canceled_at: row.canceled_at,
        cancel_reason: row.cancel_reason,
        reminder_minutes: row.reminder_minutes === null || row.reminder_minutes === undefined ? null : Number(row.reminder_minutes),
        reminder_sent_at: row.reminder_sent_at ?? null,
        can_view_details: true,
        can_manage: canManage(viewer, row, now),
        can_review: canReview(viewer, row, now),
    };
}

/**
 * Escolhe a forma pela regra de acesso. Para linha vinda da consulta
 * mascarada (sem `created_by`), a regra só pode dar "não" — o que é o certo,
 * já que essa consulta só traz o que está fora do escopo de detalhes.
 */
function shapeFor(row, viewer, now) {
    return canViewDetails(viewer, row) ? shapeDetailed(row, viewer, now) : shapeMasked(row);
}

/** Ordem da agenda: data, início, espaço. */
function compareBookings(a, b) {
    return a.booking_date.localeCompare(b.booking_date)
        || a.start_time.localeCompare(b.start_time)
        || a.space_id - b.space_id;
}

module.exports = { PUBLIC_FIELDS, shapeMasked, shapeDetailed, shapeFor, compareBookings };
