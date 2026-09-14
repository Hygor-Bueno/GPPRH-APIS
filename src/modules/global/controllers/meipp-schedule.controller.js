/**
 * @fileoverview Controller de agendamentos e seus alvos.
 *
 * @module modules/global/controllers/meipp-schedule.controller
 */

const { MeippScheduleUseCases } = require('../application/meipp/schedule/meipp-schedule.use-cases');
const { MysqlMeippScheduleRepository } = require('../infrastructure/meipp/mysql-meipp-schedule.repository');
const { MysqlMeippPlaylistRepository } = require('../infrastructure/meipp/mysql-meipp-playlist.repository');
const { respond } = require('../../../utils/respond');

const useCases = new MeippScheduleUseCases({
    repository: new MysqlMeippScheduleRepository(),
    playlistRepository: new MysqlMeippPlaylistRepository(),
});

async function list(req, res) {
    return respond.ok(res, await useCases.list(req.query));
}

async function getById(req, res) {
    return respond.ok(res, await useCases.getById(Number(req.params.id)));
}

async function create(req, res) {
    return respond.created(res, await useCases.create(req.body, req.meippUser));
}

async function update(req, res) {
    return respond.ok(res, await useCases.update(Number(req.params.id), req.body));
}

async function remove(req, res) {
    return respond.ok(res, await useCases.remove(Number(req.params.id)));
}

async function listTargets(req, res) {
    return respond.ok(res, await useCases.listTargets(Number(req.params.id)));
}

async function addTarget(req, res) {
    return respond.created(res, await useCases.addTarget(Number(req.params.id), req.body));
}

async function removeTarget(req, res) {
    const result = await useCases.removeTarget(Number(req.params.id), Number(req.params.targetId));
    return respond.ok(res, result);
}

module.exports = { list, getById, create, update, remove, listTargets, addTarget, removeTarget };
