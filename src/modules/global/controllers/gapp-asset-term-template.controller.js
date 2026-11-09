const { GappAssetTermTemplateUseCases } = require('../application/gapp/asset-term-template/gapp-asset-term-template.use-cases');
const { MysqlAssetTermTemplateRepository } = require('../infrastructure/gapp/mysql-asset-term-template.repository');
const { respond } = require('../../../utils/respond');

const useCases = new GappAssetTermTemplateUseCases({
    repository: new MysqlAssetTermTemplateRepository(),
});

/**
 * GET /gapp/asset-term-template/fields
 * Tipos de ativo e campos dinâmicos disponíveis para os moldes.
 */
async function getTemplateFields(req, res) {
    return respond.ok(res, useCases.getFields());
}

/**
 * GET /gapp/asset-term-template
 * Query: ?asset_type=smartphone&status_template=1&name=X (todos opcionais)
 */
async function listTemplates(req, res) {
    const result = await useCases.listTemplates(req.query);
    return respond.ok(res, result);
}

/**
 * GET /gapp/asset-term-template/:id
 */
async function getTemplateById(req, res) {
    const result = await useCases.getTemplateById(req.params.id);
    return respond.ok(res, result);
}

/**
 * POST /gapp/asset-term-template
 * Body: { name, asset_type, content, status_template? }
 */
async function createTemplate(req, res) {
    const result = await useCases.createTemplate(req.body ?? {}, req.user.id);
    return respond.created(res, result);
}

/**
 * PUT /gapp/asset-term-template/:id
 * Body: mesmos campos do POST, todos opcionais.
 */
async function updateTemplate(req, res) {
    const result = await useCases.updateTemplate(req.params.id, req.body ?? {}, req.user.id);
    return respond.ok(res, result);
}

module.exports = { getTemplateFields, listTemplates, getTemplateById, createTemplate, updateTemplate };
