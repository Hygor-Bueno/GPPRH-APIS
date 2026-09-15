/**
 * @fileoverview Controller de locais do miepp.
 *
 * @module modules/global/controllers/miepp-location.controller
 */

const { MieppLocationUseCases } = require('../application/miepp/location/miepp-location.use-cases');
const { MysqlMieppLocationRepository } = require('../infrastructure/miepp/mysql-miepp-location.repository');
const { respond } = require('../../../utils/respond');

const useCases = new MieppLocationUseCases({
    repository: new MysqlMieppLocationRepository(),
});

async function list(req, res) {
    return respond.ok(res, await useCases.list(req.query));
}

async function getById(req, res) {
    return respond.ok(res, await useCases.getById(Number(req.params.id)));
}

async function create(req, res) {
    return respond.created(res, await useCases.create(req.body));
}

async function update(req, res) {
    return respond.ok(res, await useCases.update(Number(req.params.id), req.body));
}

async function remove(req, res) {
    return respond.ok(res, await useCases.remove(Number(req.params.id)));
}

module.exports = { list, getById, create, update, remove };
