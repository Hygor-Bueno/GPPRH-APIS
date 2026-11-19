const { GappAssetTermUseCases } = require('../application/gapp/asset-term/gapp-asset-term.use-cases');
const { MysqlAssetTermRepository } = require('../infrastructure/gapp/mysql-asset-term.repository');
const { GappAssetTermStorage } = require('../infrastructure/gapp/gapp-asset-term.storage');
const { respond } = require('../../../utils/respond');

const useCases = new GappAssetTermUseCases({
    repository: new MysqlAssetTermRepository(),
    storage: new GappAssetTermStorage(),
});

/**
 * GET /gapp/asset-term
 * Query: ?asset_term_id=X&reponsible_name=X&active_id_fk=X&date_start=AAAA-MM-DD&date_end=AAAA-MM-DD&page=1&limit=20 (todos opcionais)
 */
async function listAssetTerms(req, res) {
    const result = await useCases.listAssetTerms(req.query);
    return respond.ok(res, result);
}

/**
 * GET /gapp/asset-term/:id
 */
async function getAssetTermById(req, res) {
    const result = await useCases.getAssetTermById(req.params.id);
    return respond.ok(res, result);
}

/**
 * POST /gapp/asset-term (multipart/form-data)
 * Campos: file (obrigatório), reponsible_name, reponsible_registration, active_id_fk.
 * O termo nasce vinculado (status_term = 1); os outros termos do ativo não mudam.
 * `created_by`, `file_id_fk` e `file_name` saem do usuário autenticado e do upload.
 */
async function createAssetTerm(req, res) {
    const result = await useCases.createAssetTerm(req.body ?? {}, req.file, req.user.id);
    return respond.created(res, result);
}

/**
 * PUT /gapp/asset-term/:id (multipart/form-data)
 * Campos opcionais: file, reponsible_name, active_id_fk. O que não for enviado mantém o valor atual.
 */
async function updateAssetTerm(req, res) {
    const result = await useCases.updateAssetTerm(req.params.id, req.body ?? {}, req.file, req.user.id);
    return respond.ok(res, result);
}

/**
 * PATCH /gapp/asset-term/:id/status
 * Body: { status_term } — 1 vincula, 0 desvincula o colaborador deste termo.
 */
async function setAssetTermStatus(req, res) {
    const result = await useCases.setTermStatus(req.params.id, req.body.status_term);
    return respond.ok(res, result);
}

/**
 * DELETE /gapp/asset-term/:id
 * Remove o termo e libera o arquivo, se nenhum outro termo o usar.
 */
async function deleteAssetTerm(req, res) {
    await useCases.deleteAssetTerm(req.params.id, req.user.id);
    return respond.message(res, 'Termo excluído com sucesso');
}

module.exports = { listAssetTerms, getAssetTermById, createAssetTerm, updateAssetTerm, setAssetTermStatus, deleteAssetTerm };
