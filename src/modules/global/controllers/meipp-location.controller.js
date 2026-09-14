/**
 * @fileoverview Controller de locais do meipp.
 *
 * @module modules/global/controllers/meipp-location.controller
 */

const { MeippLocationUseCases } = require('../application/meipp/location/meipp-location.use-cases');
const { MysqlMeippLocationRepository } = require('../infrastructure/meipp/mysql-meipp-location.repository');
const { respond } = require('../../../utils/respond');

const useCases = new MeippLocationUseCases({
    repository: new MysqlMeippLocationRepository(),
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
