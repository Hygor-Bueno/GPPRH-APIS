/**
 * @fileoverview Controller da trilha de auditoria do miepp (somente leitura).
 *
 * A gravação é automática, feita pelo `miepp-audit.middleware` — não há rota
 * para inserir na trilha, de propósito: uma trilha que aceita escrita pela API
 * deixa de valer como evidência.
 *
 * @module modules/global/controllers/miepp-audit.controller
 */

const { MieppAuditUseCases } = require('../application/miepp/audit/miepp-audit.use-cases');
const { MysqlMieppAuditRepository } = require('../infrastructure/miepp/mysql-miepp-audit.repository');
const { respond } = require('../../../utils/respond');

const useCases = new MieppAuditUseCases({
    repository: new MysqlMieppAuditRepository(),
});

/**
 * @route GET /miepp/audit-log?entity_type=player&user_id=3&page=1&limit=50
 */
async function list(req, res) {
    return respond.ok(res, await useCases.list(req.query));
}

module.exports = { list };
