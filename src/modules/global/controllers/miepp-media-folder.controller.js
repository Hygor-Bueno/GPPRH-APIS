/**
 * @fileoverview Controller das pastas da biblioteca de mídia do miepp.
 *
 * @module modules/global/controllers/miepp-media-folder.controller
 */

const { MieppMediaFolderUseCases } = require('../application/miepp/media/miepp-media-folder.use-cases');
const { MysqlMieppMediaFolderRepository } = require('../infrastructure/miepp/mysql-miepp-media-folder.repository');
const { respond } = require('../../../utils/respond');

const useCases = new MieppMediaFolderUseCases({
    repository: new MysqlMieppMediaFolderRepository(),
});

async function list(req, res) {
    return respond.ok(res, await useCases.list());
}

async function getById(req, res) {
    return respond.ok(res, await useCases.getById(Number(req.params.id)));
}

async function create(req, res) {
    return respond.created(res, await useCases.create(req.body, req.user));
}

async function update(req, res) {
    return respond.ok(res, await useCases.update(Number(req.params.id), req.body));
}

async function remove(req, res) {
    return respond.ok(res, await useCases.remove(Number(req.params.id)));
}

module.exports = { list, getById, create, update, remove };
