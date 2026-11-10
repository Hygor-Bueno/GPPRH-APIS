/**
 * @fileoverview Controller da migração TEMPORÁRIA de termos do legado.
 *
 * O termo é criado pelo `GappAssetTermUseCases` de sempre (mesmo repositório e
 * mesmo storage do POST /gapp/asset-term) — nenhum mecanismo paralelo de
 * arquivo ou de vínculo.
 *
 * @module modules/global/controllers/gapp-term-migration.controller
 */

const { GappTermMigrationUseCases } = require('../application/gapp/term-migration/gapp-term-migration.use-cases');
const { GappAssetTermUseCases } = require('../application/gapp/asset-term/gapp-asset-term.use-cases');
const { MysqlTermMigrationRepository } = require('../infrastructure/gapp/mysql-term-migration.repository');
const { FsTermMigrationSource } = require('../infrastructure/gapp/fs-term-migration.source');
const { MysqlAssetTermRepository } = require('../infrastructure/gapp/mysql-asset-term.repository');
const { GappAssetTermStorage } = require('../infrastructure/gapp/gapp-asset-term.storage');
const { respond } = require('../../../utils/respond');

const useCases = new GappTermMigrationUseCases({
    repository: new MysqlTermMigrationRepository(),
    source: new FsTermMigrationSource(),
    termCreator: new GappAssetTermUseCases({
        repository: new MysqlAssetTermRepository(),
        storage: new GappAssetTermStorage(),
    }),
});

/** GET /gapp/term-migration/summary */
async function summary(req, res) {
    return respond.ok(res, await useCases.summary());
}

/** GET /gapp/term-migration?status=&issue_code=&search=&page=&limit= */
async function list(req, res) {
    return respond.ok(res, await useCases.list(req.query));
}

/** GET /gapp/term-migration/:id — registro + trilha. */
async function getById(req, res) {
    return respond.ok(res, await useCases.getById(req.params.id));
}

/** POST /gapp/term-migration/scan */
async function scan(req, res) {
    return respond.ok(res, await useCases.scan(req.user.id));
}

/** POST /gapp/term-migration/validate { ids?, limit? } */
async function validate(req, res) {
    return respond.ok(res, await useCases.validate(req.body ?? {}, req.user.id));
}

/** POST /gapp/term-migration/migrate { ids?, limit? } */
async function migrate(req, res) {
    return respond.ok(res, await useCases.migrate(req.body ?? {}, req.user.id));
}

/** POST /gapp/term-migration/retry { ids?, limit? } */
async function retry(req, res) {
    return respond.ok(res, await useCases.retry(req.body ?? {}, req.user.id));
}

/** PATCH /gapp/term-migration/:id/ignore { reason? } */
async function ignore(req, res) {
    return respond.ok(res, await useCases.ignore(req.params.id, req.body?.reason, req.user.id));
}

/** PATCH /gapp/term-migration/:id/restore */
async function restore(req, res) {
    return respond.ok(res, await useCases.restore(req.params.id, req.user.id));
}

module.exports = { summary, list, getById, scan, validate, migrate, retry, ignore, restore };
