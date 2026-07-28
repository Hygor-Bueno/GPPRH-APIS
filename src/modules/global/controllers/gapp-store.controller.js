const { GappStoreUseCases } = require('../application/gapp/store/gapp-store.use-cases');
const { MysqlStoreRepository } = require('../infrastructure/gapp/mysql-store.repository');
const { respond } = require('../../../utils/respond');
const { AppError } = require('../../../errors/app.error');

const useCases = new GappStoreUseCases({
    repository: new MysqlStoreRepository(),
});

/**
 * GET /gapp/store
 * Query: ?name=X&city=X&state=X&status_store=1&page=1&limit=20 (todos opcionais)
 */
async function listStores(req, res) {
    const result = await useCases.listStores(req.query);
    return respond.ok(res, result);
}

/**
 * GET /gapp/store/:id
 */
async function getStoreById(req, res) {
    const result = await useCases.getStoreById(req.params.id);
    return respond.ok(res, result);
}

/**
 * POST /gapp/store
 * Body: { cnpj?, name, street, district?, city, state, number, zip_code, complement?, status_store? }
 */
async function createStore(req, res) {
    const required = ['name', 'street', 'city', 'state', 'number', 'zip_code'];
    const missing = required.filter(f => req.body[f] == null || req.body[f] === '');
    if (missing.length) {
        throw new AppError(`Campos obrigatórios ausentes: ${missing.join(', ')}`, 400);
    }
    const result = await useCases.createStore(req.body);
    return respond.created(res, result);
}

/**
 * PUT /gapp/store/:id
 * Body: mesmos campos do POST
 */
async function updateStore(req, res) {
    const required = ['name', 'street', 'city', 'state', 'number', 'zip_code'];
    const missing = required.filter(f => req.body[f] == null || req.body[f] === '');
    if (missing.length) {
        throw new AppError(`Campos obrigatórios ausentes: ${missing.join(', ')}`, 400);
    }
    const result = await useCases.updateStore(req.params.id, req.body);
    return respond.ok(res, result);
}

/**
 * DELETE /gapp/store/:id
 * Exclusão lógica — nunca remove a linha, só desativa via status_store.
 */
async function deleteStore(req, res) {
    await useCases.deleteStore(req.params.id);
    return respond.message(res, 'Loja excluída com sucesso');
}

module.exports = { listStores, getStoreById, createStore, updateStore, deleteStore };
