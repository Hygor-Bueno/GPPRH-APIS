/**
 * @fileoverview Quem pode o quê numa auditoria (GAPP).
 *
 * - Solicitante = quem abriu (`user_open_id_fk`): só ele finaliza, cancela e
 *   muda os responsáveis.
 * - Conferem (registrar/editar conferência, incluir não previsto): o
 *   solicitante e os responsáveis (`gapp_active_audit_user`, vários). Sem
 *   responsáveis, só o solicitante.
 * - Ids são `_user.id` (o `req.user.id`). Ver e gerar relatório continua com
 *   qualquer usuário do grupo de trabalho.
 *
 * @module modules/global/domain/gapp/active-audit/audit-access.rules
 */

'use strict';

/** Teto de responsáveis por auditoria. */
const MAX_ASSIGNEES = 50;

const sameUser = (a, b) => a != null && b != null && Number(a) === Number(b);

/** Ids dos responsáveis: a consulta traz "20,31" (GROUP_CONCAT); a apresentação, a lista. */
function assigneeIds(audit) {
    const raw = audit?.assignee_ids;
    if (Array.isArray(raw)) return raw.map(Number);
    return raw ? String(raw).split(',').map(Number) : [];
}

const isRequester = (audit, userId) => sameUser(audit?.user_open_id_fk, userId);

const isAssignee = (audit, userId) => userId != null && assigneeIds(audit).includes(Number(userId));

const canRegister = (audit, userId) => isRequester(audit, userId) || isAssignee(audit, userId);

const ACCESS_ERROR = Object.freeze({
    NOT_REQUESTER: 'GAPP_AUDIT_NOT_REQUESTER',
    NOT_ASSIGNED: 'GAPP_AUDIT_NOT_ASSIGNED',
    INVALID_ASSIGNEE: 'GAPP_AUDIT_INVALID_ASSIGNEE',
});

/** Recusa de quem não abriu a auditoria (`action`: "finalizá-la", "cancelá-la"...). */
const notRequesterMessage = action => `Só quem abriu a auditoria pode ${action}.`;

const NOT_ASSIGNED_MESSAGE = 'Só quem abriu a auditoria e os responsáveis por ela podem registrar conferências.';

const INVALID_IDS = "O campo 'user_assigned_ids' deve ser uma lista de ids de usuário.";

/**
 * Responsáveis (opcional): lista de ids positivos, sem repetição; vazio/nulo = nenhum.
 * Quem abriu sai da lista — ele já confere por ser o solicitante.
 * @returns {{ value?: number[], error?: string }}
 */
function normalizeAssignees(raw, requesterId = null) {
    if (raw === undefined || raw === null || raw === '') return { value: [] };
    if (!Array.isArray(raw)) return { error: INVALID_IDS };
    const ids = raw.map(Number);
    if (!ids.every(id => Number.isInteger(id) && id > 0)) return { error: INVALID_IDS };
    const value = [...new Set(ids)].filter(id => !sameUser(id, requesterId));
    if (value.length > MAX_ASSIGNEES) return { error: `Escolha no máximo ${MAX_ASSIGNEES} responsáveis.` };
    return { value };
}

module.exports = {
    ACCESS_ERROR,
    MAX_ASSIGNEES,
    assigneeIds,
    isRequester,
    isAssignee,
    canRegister,
    notRequesterMessage,
    NOT_ASSIGNED_MESSAGE,
    normalizeAssignees,
};
