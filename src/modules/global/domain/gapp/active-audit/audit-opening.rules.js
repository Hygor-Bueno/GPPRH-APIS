/**
 * @fileoverview Regras puras da abertura da auditoria (GAPP): nome, prazo,
 * escopo (lojas do Protheus) e filtros de ativos.
 *
 * - Escopo = ONDE a auditoria acontece: uma ou mais lojas do Protheus
 *   (empresa + filial e, opcional, centro de custo; sem centro = filial
 *   inteira). Só registra — não filtra ativos (os ativos do GAPP não têm
 *   vínculo com filial/centro de custo do Protheus).
 * - Filtros dos ativos: só classe e tipo.
 * - Códigos do Protheus são texto: zeros à esquerda ('02', '0202') nunca
 *   viram número. A existência é conferida no Protheus pelo use-case
 *   (`scopeNameError` sobre as linhas já com nome).
 *
 * @module modules/global/domain/gapp/active-audit/audit-opening.rules
 */

'use strict';

const { normalizeActiveIds } = require('./active-audit.rules');
const { normalizeAssignees } = require('./audit-access.rules');

const MAX_NAME_LENGTH = 150;
const MAX_SCOPE_ROWS = 50;
const CODE_LIMITS = Object.freeze({ company_code: 10, branch_code: 12, cost_center_code: 20 });
const FILTER_FIELDS = Object.freeze(['id_active_class_fk', 'active_type_id_fk']);
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const text = value => (value == null ? '' : String(value).trim());
const p2 = n => String(n).padStart(2, '0');

/** Date (mysql2 lê DATE na hora local) ou 'AAAA-MM-DD…' → 'AAAA-MM-DD'; `null` se vazio. */
function dateKey(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date) return `${value.getFullYear()}-${p2(value.getMonth() + 1)}-${p2(value.getDate())}`;
    return String(value).slice(0, 10);
}

/** Data de calendário real (rejeita 2026-02-30). */
function isRealDate(value) {
    const match = DATE_RE.exec(value);
    if (!match) return false;
    const [y, m, d] = match.slice(1).map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Prazo opcional: data real, não anterior a hoje. @returns {{ value?: string|null, error?: string }} */
function normalizeDeadline(value, now = new Date()) {
    const raw = text(value);
    if (!raw) return { value: null };
    if (!isRealDate(raw)) return { error: 'Prazo inválido. Use uma data no formato AAAA-MM-DD.' };
    if (raw < dateKey(now)) return { error: 'O prazo não pode ser anterior a hoje.' };
    return { value: raw };
}

/** Uma loja do escopo. @returns {{ row?: object, error?: string }} */
function normalizeScopeRow(raw, index) {
    const row = {
        company_code: text(raw?.company_code),
        branch_code: text(raw?.branch_code),
        cost_center_code: text(raw?.cost_center_code) || null,
    };
    if (!row.company_code || !row.branch_code) return { error: `Escopo ${index + 1}: informe a empresa e a filial.` };
    for (const [field, max] of Object.entries(CODE_LIMITS)) {
        if (row[field] && row[field].length > max) return { error: `Escopo ${index + 1}: '${field}' com mais de ${max} caracteres.` };
    }
    return { row };
}

const branchKey = row => `${row.company_code}|${row.branch_code}`;
const rowLabel = row => [row.company_code, row.branch_code, row.cost_center_code].filter(Boolean).join('/');

/** Loja repetida, ou filial inteira junto com centro de custo da mesma filial. */
function findScopeConflict(rows) {
    const seen = new Set();
    const wholeBranches = new Set(rows.filter(row => !row.cost_center_code).map(branchKey));
    for (const row of rows) {
        const key = `${branchKey(row)}|${row.cost_center_code ?? ''}`;
        if (seen.has(key)) return `Loja repetida no escopo: ${rowLabel(row)}.`;
        seen.add(key);
        if (row.cost_center_code && wholeBranches.has(branchKey(row))) {
            return `A filial ${row.branch_code} já está inteira no escopo; não informe centros de custo dela.`;
        }
    }
    return null;
}

/** Lista de lojas: 1 a 50, válidas e sem conflito. @returns {{ rows?: object[], error?: string }} */
function normalizeScope(input) {
    if (!Array.isArray(input) || input.length === 0) return { error: 'Informe ao menos uma loja no escopo da auditoria.' };
    if (input.length > MAX_SCOPE_ROWS) return { error: `O escopo aceita no máximo ${MAX_SCOPE_ROWS} lojas.` };
    const rows = [];
    for (const [index, raw] of input.entries()) {
        const { row, error } = normalizeScopeRow(raw, index);
        if (error) return { error };
        rows.push(row);
    }
    const conflict = findScopeConflict(rows);
    return conflict ? { error: conflict } : { rows };
}

/**
 * Lojas já com os nomes do Protheus: código sem nome = não existe (ou a
 * filial/centro de custo não é da empresa). @returns {string|null}
 */
function scopeNameError(namedRows) {
    for (const row of namedRows) {
        if (!row.company_name) return `Empresa ${row.company_code} não encontrada no Protheus.`;
        if (!row.branch_name) return `Filial ${row.branch_code} não encontrada na empresa ${row.company_code}.`;
        if (row.cost_center_code && !row.cost_center_name) {
            return `Centro de custo ${row.cost_center_code} não encontrado na empresa ${row.company_code}.`;
        }
    }
    return null;
}

/** Classe e tipo (ids opcionais). @returns {{ filters?: object, error?: string }} */
function normalizeFilters(data) {
    const filters = {};
    for (const field of FILTER_FIELDS) {
        const raw = data[field];
        if (raw === undefined || raw === null || raw === '') { filters[field] = null; continue; }
        const id = Number(raw);
        if (!Number.isInteger(id) || id <= 0) return { error: `O campo '${field}' deve ser um id válido.` };
        filters[field] = id;
    }
    return { filters };
}

/** `active_ids` vazio ou ausente = todos os ativos dos filtros. */
function normalizeOpeningIds(value) {
    const hasIds = Array.isArray(value) ? value.length > 0 : value != null;
    return hasIds ? normalizeActiveIds(value) : { ids: null };
}

/**
 * Corpo da abertura. `requesterId` (quem abre) sai da lista de responsáveis.
 * @returns {{ value?: { name, deadline, scope, filters, active_ids, assignees }, error?: string }}
 */
function normalizeOpenAudit(data = {}, now = new Date(), requesterId = null) {
    const name = text(data.audit_name);
    if (!name) return { error: 'Informe o nome da auditoria.' };
    if (name.length > MAX_NAME_LENGTH) return { error: `O nome da auditoria deve ter no máximo ${MAX_NAME_LENGTH} caracteres.` };
    const steps = [normalizeDeadline(data.date_deadline, now), normalizeScope(data.scope), normalizeFilters(data),
        normalizeOpeningIds(data.active_ids), normalizeAssignees(data.user_assigned_ids, requesterId)];
    const failed = steps.find(step => step.error);
    if (failed) return { error: failed.error };
    const [deadline, scope, filters, ids, assignees] = steps;
    return { value: { name, deadline: deadline.value, scope: scope.rows, filters: filters.filters, active_ids: ids.ids, assignees: assignees.value } };
}

/** Prazo vencido: aberta/em andamento com prazo antes de hoje. */
const isOverdue = (audit, now = new Date()) =>
    [0, 1].includes(Number(audit?.status_audit)) && audit?.date_deadline != null && dateKey(audit.date_deadline) < dateKey(now);

module.exports = {
    MAX_SCOPE_ROWS,
    dateKey,
    normalizeDeadline,
    normalizeScope,
    scopeNameError,
    normalizeOpenAudit,
    isOverdue,
};
