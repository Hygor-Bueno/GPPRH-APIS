const { GappActiveIdentifierUseCases } = require('../application/gapp/active-identifier/gapp-active-identifier.use-cases');
const { MysqlActiveIdentifierRepository } = require('../infrastructure/gapp/mysql-active-identifier.repository');
const { MysqlGappUserRepository } = require('../infrastructure/gapp/mysql-gapp-user.repository');
const { respond } = require('../../../utils/respond');

const useCases = new GappActiveIdentifierUseCases({
    repository: new MysqlActiveIdentifierRepository(),
    userRepository: new MysqlGappUserRepository(),
});

/** GET /gapp/active/:id/identifiers — identificadores do ativo, o principal primeiro. */
async function listIdentifiers(req, res) {
    const result = await useCases.list(req.params.id, req.user);
    return respond.ok(res, result);
}

/**
 * POST /gapp/active/:id/identifiers
 * Body: { identifier_type: 'PATRIMONIO' | 'SERIAL', identifier_value, is_primary? } — devolve a lista atualizada.
 */
async function createIdentifier(req, res) {
    const result = await useCases.create(req.params.id, req.body ?? {}, req.user);
    return respond.created(res, result);
}

/** PATCH /gapp/active/:id/identifiers/:identifierId/primary — passa a ser o principal do ativo. */
async function setPrimaryIdentifier(req, res) {
    const result = await useCases.setPrimary(req.params.id, req.params.identifierId, req.user);
    return respond.ok(res, result);
}

/** DELETE /gapp/active/:id/identifiers/:identifierId — devolve a lista atualizada. */
async function deleteIdentifier(req, res) {
    const result = await useCases.remove(req.params.id, req.params.identifierId, req.user);
    return respond.ok(res, result);
}

module.exports = { listIdentifiers, createIdentifier, setPrimaryIdentifier, deleteIdentifier };
