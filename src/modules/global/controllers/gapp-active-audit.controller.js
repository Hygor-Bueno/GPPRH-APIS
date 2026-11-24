const { GappActiveAuditUseCases } = require('../application/gapp/active-audit/gapp-active-audit.use-cases');
const { MysqlActiveAuditRepository } = require('../infrastructure/gapp/mysql-active-audit.repository');
const { MysqlGappUserRepository } = require('../infrastructure/gapp/mysql-gapp-user.repository');
const { GappActiveAuditIdentifyUseCases } = require('../application/gapp/active-audit/gapp-active-audit-identify.use-cases');
const { MysqlActiveIdentifierRepository } = require('../infrastructure/gapp/mysql-active-identifier.repository');
const { GappActiveAuditReportUseCases } = require('../application/gapp/active-audit/gapp-active-audit-report.use-cases');
const { PuppeteerTaskDossierRenderer } = require('../infrastructure/gtpp/puppeteer-task-dossier.renderer');
const { ProtheusUseCases } = require('../../protheus/application/protheus.use-cases');
const { SqlServerProtheusRepository } = require('../../protheus/infrastructure/sqlserver-protheus.repository');
const { ProtheusGtppScopeNameResolver } = require('../infrastructure/gtpp/protheus-gtpp-scope-name.resolver');
const { respond } = require('../../../utils/respond');

const useCases = new GappActiveAuditUseCases({
    repository: new MysqlActiveAuditRepository(),
    userRepository: new MysqlGappUserRepository(),
    // Mesmo tradutor de códigos do escopo de tarefas do GTPP: confere as lojas na abertura e dá os nomes na leitura
    scopeNameResolver: new ProtheusGtppScopeNameResolver({
        protheusUseCases: new ProtheusUseCases({ repository: new SqlServerProtheusRepository() }),
    }),
});

const identifyUseCases = new GappActiveAuditIdentifyUseCases({
    repository: new MysqlActiveAuditRepository(),
    identifierRepository: new MysqlActiveIdentifierRepository(),
    userRepository: new MysqlGappUserRepository(),
});

// Mesmo renderizador do dossiê do GTPP, com fila e mensagens próprias.
const reportUseCases = new GappActiveAuditReportUseCases({
    auditUseCases: useCases,
    repository: new MysqlActiveAuditRepository(),
    renderer: new PuppeteerTaskDossierRenderer({
        errors: {
            busy: { message: 'Há muitos relatórios sendo gerados agora. Tente novamente em instantes.', code: 'GAPP_AUDIT_REPORT_BUSY' },
            failed: { message: 'Não foi possível gerar o relatório da auditoria.', code: 'GAPP_AUDIT_REPORT_FAILED' },
        },
    }),
});

/** GET /gapp/active-audit/:id/report — relatório da auditoria em PDF (download para imprimir). */
async function downloadAuditReport(req, res) {
    const { buffer, fileName } = await reportUseCases.generateReport(req.params.id, req.user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    return res.send(buffer);
}

/**
 * GET /gapp/active-audit/:id/identify?identifier_type&identifier_value
 * Ativo do identificador e se ele faz parte da auditoria: { in_audit, asset, identifier }.
 */
async function identifyAsset(req, res) {
    const result = await identifyUseCases.identify(req.params.id, req.query, req.user);
    return respond.ok(res, result);
}

/** POST /gapp/active-audit/:id/assets — Body: { active_id } — inclui o ativo como não previsto. */
async function addUnexpectedAsset(req, res) {
    const result = await identifyUseCases.addUnexpected(req.params.id, req.body?.active_id, req.user);
    return respond.created(res, result);
}

/**
 * GET /gapp/active-audit
 * Query: ?audit_id&audit_name&status_audit&branch_code&active_id&date_start&date_end&page&limit (todos opcionais)
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

/**
 * POST /gapp/active-audit
 * Body: { audit_name, date_deadline?, scope: [{ company_code, branch_code, cost_center_code? }],
 *         id_active_class_fk?, active_type_id_fk?, active_ids? }
 */
async function openAudit(req, res) {
    const result = await useCases.openAudit(req.body ?? {}, req.user);
    return respond.created(res, result);
}

/**
 * POST /gapp/active-audit/:id/items
 * Body: { active_id_fk, identifier_type, identifier_value?, asset_condition, lifecycle_status,
 *         additional_items?, observations?, is_transfer?, transfer_reason?, transfer_dep_id_fk? }
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

/** PATCH /gapp/active-audit/:id/finish — consolida, confere e limpa a temporária. */
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
    identifyAsset, addUnexpectedAsset, downloadAuditReport,
};
