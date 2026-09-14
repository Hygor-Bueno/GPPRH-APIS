/**
 * @fileoverview Controller da trilha de auditoria do meipp (somente leitura).
 *
 * A gravação é automática, feita pelo `meipp-audit.middleware` — não há rota
 * para inserir na trilha, de propósito: uma trilha que aceita escrita pela API
 * deixa de valer como evidência.
 *
 * @module modules/global/controllers/meipp-audit.controller
 */

const { MeippAuditUseCases } = require('../application/meipp/audit/meipp-audit.use-cases');
const { MysqlMeippAuditRepository } = require('../infrastructure/meipp/mysql-meipp-audit.repository');
const { respond } = require('../../../utils/respond');

const useCases = new MeippAuditUseCases({
    repository: new MysqlMeippAuditRepository(),
});

/**
 * @route GET /meipp/audit-log?entity_type=player&user_id=3&page=1&limit=50
 */
async function list(req, res) {
    return respond.ok(res, await useCases.list(req.query));
}

module.exports = { list };
