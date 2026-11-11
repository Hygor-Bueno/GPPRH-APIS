/**
 * @fileoverview Consultas SQL puras para moldes de termo de ativo (gapp_asset_term_template).
 *
 * Sem execução, sem I/O.
 *
 * @module modules/global/repositories/mysql/gapp-asset-term-template.queries
 */

const TEMPLATE_FILTER_CLAUSES = {
    asset_type: 't.asset_type = ?',
    status_template: 't.status_template = ?',
    name: 't.name LIKE ?',
};

const TEMPLATE_LIKE_FIELDS = new Set(['name']);

function buildTemplateFilters(filters = {}) {
    const conditions = [];
    const params = [];

    for (const [key, clause] of Object.entries(TEMPLATE_FILTER_CLAUSES)) {
        if (filters[key] != null && filters[key] !== '') {
            conditions.push(clause);
            params.push(TEMPLATE_LIKE_FIELDS.has(key) ? `%${filters[key]}%` : filters[key]);
        }
    }

    return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

const TEMPLATE_COLUMNS = `
    t.asset_term_template_id, t.name, t.asset_type, t.status_template,
    t.created_by, t.updated_by, t.created_at, t.updated_at
`;

const TEMPLATE_FROM = 'FROM global.gapp_asset_term_template t';

/** Listagem sem o conteúdo (pode ser longo): os cartões só precisam do resumo. */
function sqlListTemplates(filters = {}) {
    const { where, params } = buildTemplateFilters(filters);
    const sql = `
        SELECT ${TEMPLATE_COLUMNS}
        ${TEMPLATE_FROM}
        ${where}
        ORDER BY t.status_template DESC, t.asset_type, t.name
    `;
    return { sql, params };
}

function sqlGetTemplateById() {
    return `
        SELECT ${TEMPLATE_COLUMNS}, t.content
        ${TEMPLATE_FROM}
        WHERE t.asset_term_template_id = ?
    `;
}

/** Nome repetido no mesmo tipo de ativo (ignorando o próprio molde na edição). */
function sqlCheckTemplateName() {
    return `
        SELECT asset_term_template_id FROM global.gapp_asset_term_template
        WHERE name = ? AND asset_type = ? AND asset_term_template_id <> ?
        LIMIT 1
    `;
}

function sqlInsertTemplate() {
    return `
        INSERT INTO global.gapp_asset_term_template
            (name, asset_type, content, status_template, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?)
    `;
}

function buildInsertTemplateParams(data) {
    return [data.name, data.asset_type, data.content, data.status_template, data.user_id, data.user_id];
}

function sqlUpdateTemplate() {
    return `
        UPDATE global.gapp_asset_term_template
        SET name = ?, asset_type = ?, content = ?, status_template = ?, updated_by = ?, updated_at = NOW()
        WHERE asset_term_template_id = ?
    `;
}

function buildUpdateTemplateParams(data, templateId) {
    return [data.name, data.asset_type, data.content, data.status_template, data.user_id, templateId];
}

module.exports = {
    sqlListTemplates, sqlGetTemplateById, sqlCheckTemplateName,
    sqlInsertTemplate, buildInsertTemplateParams,
    sqlUpdateTemplate, buildUpdateTemplateParams,
};
