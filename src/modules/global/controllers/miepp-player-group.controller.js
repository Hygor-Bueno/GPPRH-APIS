/**
 * @fileoverview Controller de grupos de players.
 *
 * @module modules/global/controllers/miepp-player-group.controller
 */

const { MieppPlayerGroupUseCases } = require('../application/miepp/player-group/miepp-player-group.use-cases');
const { MysqlMieppPlayerGroupRepository } = require('../infrastructure/miepp/mysql-miepp-player-group.repository');
const { MysqlMieppPlayerRepository } = require('../infrastructure/miepp/mysql-miepp-player.repository');
const { respond } = require('../../../utils/respond');

const useCases = new MieppPlayerGroupUseCases({
    repository: new MysqlMieppPlayerGroupRepository(),
    playerRepository: new MysqlMieppPlayerRepository(),
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

async function addMember(req, res) {
    const result = await useCases.addMember(Number(req.params.id), Number(req.body.player_id));
    return respond.created(res, result);
}

async function removeMember(req, res) {
    const result = await useCases.removeMember(Number(req.params.id), Number(req.params.playerId));
    return respond.ok(res, result);
}

module.exports = { list, getById, create, update, remove, addMember, removeMember };
