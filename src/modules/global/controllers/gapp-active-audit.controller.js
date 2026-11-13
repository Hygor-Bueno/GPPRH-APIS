const { GappActiveAuditUseCases } = require('../application/gapp/active-audit/gapp-active-audit.use-cases');
const { MysqlActiveAuditRepository } = require('../infrastructure/gapp/mysql-active-audit.repository');
const { MysqlGappUserRepository } = require('../infrastructure/gapp/mysql-gapp-user.repository');
const { respond } = require('../../../utils/respond');

const useCases = new GappActiveAuditUseCases({
    repository: new MysqlActiveAuditRepository(),
    userRepository: new MysqlGappUserRepository(),
});

/**
 * GET /gapp/active-audit
 * Query: ?audit_id&status_audit&active_id&date_start&date_end&page&limit (todos opcionais)
 */
async function listAudits(req, res) {
    const result = await useCases.listAudits(req.query, req.user);
    return respond.ok(res, result);
}

/** GET /gapp/active-audit/:id — cabeçalho, initial_data, final_data e conferências. */
async function getAuditById(req, res) {
    const result = await useCases.getAuditById(req.params.id, req.user);
    return respond.ok(res, result);
}

/** GET /gapp/active-audit/:id/review — resumo para revisão antes da finalização. */
async function getReview(req, res) {
    const result = await useCases.getReview(req.params.id, req.user);
    return respond.ok(res, result);
}

/** POST /gapp/active-audit — Body: { active_ids: number[] } */
async function openAudit(req, res) {
    const result = await useCases.openAudit(req.body ?? {}, req.user);
    return respond.created(res, result);
}

/**
 * POST /gapp/active-audit/:id/items
 * Body: { active_id_fk, identifier_type, identifier_value?, asset_condition, additional_items?, observations? }
 */
async function registerItem(req, res) {
    const result = await useCases.registerItem(req.params.id, req.body ?? {}, req.user);
    return respond.created(res, result);
}

/** PUT /gapp/active-audit/:id/items/:activeId — campos não enviados mantêm o valor atual. */
async function updateItem(req, res) {
    const result = await useCases.updateItem(req.params.id, req.params.activeId, req.body ?? {}, req.user);
    return respond.ok(res, result);
}

/** PATCH /gapp/active-audit/:id/finish */
async function finishAudit(req, res) {
    const result = await useCases.finishAudit(req.params.id, req.user);
    return respond.ok(res, result);
}

/** PATCH /gapp/active-audit/:id/cancel — Body: { reason? } */
async function cancelAudit(req, res) {
    const result = await useCases.cancelAudit(req.params.id, req.body ?? {}, req.user);
    return respond.ok(res, result);
}

module.exports = {
    listAudits, getAuditById, getReview, openAudit,
    registerItem, updateItem, finishAudit, cancelAudit,
};
