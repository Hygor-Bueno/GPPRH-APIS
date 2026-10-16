/**
 * @fileoverview Ajuste no formato da resposta HTTP (snake_case), a partir do
 * objeto camelCase que o repositório devolve.
 *
 * Puro.
 *
 * @module modules/global/domain/cppp/adjustment/adjustment.shaper
 */

const { JUSTIFICATION_TYPES } = require('./adjustment.rules');

/**
 * Por dentro, a visão tratada usa `YYYY-MM-DD HH:MM:SS`; para fora, o mesmo
 * `YYYY-MM-DDTHH:MM:SS` sem fuso de todo DATETIME da API (`localDateTime()`),
 * que o `parseApiDate` do front lê como hora local.
 */
const apiDateTime = (value) => (value ? String(value).replace(' ', 'T') : null);

/**
 * @param {object} adjustment
 * @returns {object}
 */
function toApiAdjustment(adjustment) {
    if (!adjustment) return null;
    return {
        id: adjustment.id,
        cpf: adjustment.cpf,
        work_date: adjustment.workDate,
        type: adjustment.type,
        justifies_day: JUSTIFICATION_TYPES.includes(adjustment.type),
        device_id: adjustment.deviceId ?? null,
        nsr: adjustment.nsr ?? null,
        punch_at: apiDateTime(adjustment.punchAt),
        starts_at: apiDateTime(adjustment.startsAt),
        ends_at: apiDateTime(adjustment.endsAt),
        period_start: adjustment.periodStart ?? null,
        period_end: adjustment.periodEnd ?? null,
        reason: adjustment.reason,
        has_attachment: Boolean(adjustment.attachmentFileId),
        created_by: adjustment.createdBy ?? null,
        created_by_name: adjustment.createdByName ?? null,
        created_at: adjustment.createdAt ?? null,
        status: adjustment.canceledAt ? 'cancelado' : 'ativo',
        canceled_at: adjustment.canceledAt ?? null,
        canceled_by: adjustment.canceledBy ?? null,
        canceled_by_name: adjustment.canceledByName ?? null,
        cancel_reason: adjustment.cancelReason ?? null,
    };
}

module.exports = { toApiAdjustment };
