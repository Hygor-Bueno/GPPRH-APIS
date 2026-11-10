// Schemas da migração TEMPORÁRIA de termos do legado (GAPP).
//
// Arquivo próprio (e não dentro do gapp.schema) para o módulo sair inteiro
// quando a migração acabar.

const { BadRequestError } = require('../errors/bad-request.error');
const { ALL_STATUSES, ISSUE } = require('../modules/global/domain/gapp/term-migration/term-migration.rules');

const listTermMigrationQuerySchema = {
    status:       { type: 'string', enum: ALL_STATUSES },
    issue_code:   { type: 'string', enum: Object.values(ISSUE) },
    active_id_fk: { type: 'number', min: 1 },
    search:       { type: 'string', maxLength: 100 },
    page:         { type: 'number', min: 1 },
    limit:        { type: 'number', min: 1, max: 200 },
};

/** Lote: `limit` (próximos da fila) OU `ids` (registros escolhidos na tela). */
const batchSchema = {
    limit: { type: 'number', min: 1, max: 1000 },
};

const ignoreSchema = {
    reason: { type: 'string', maxLength: 500 },
};

/**
 * `ids`, quando vem, é lista de inteiros positivos (o validador genérico não
 * conhece array). O teto por ação é aplicado no caso de uso.
 */
function validateIdList(req, res, next) {
    const ids = req.body?.ids;
    if (ids === undefined || ids === null) return next();
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000
        || !ids.every(id => Number.isSafeInteger(Number(id)) && Number(id) > 0)) {
        return next(new BadRequestError("O campo 'ids' deve ser uma lista de 1 a 1000 ids numéricos."));
    }
    return next();
}

module.exports = { listTermMigrationQuerySchema, batchSchema, ignoreSchema, validateIdList };
