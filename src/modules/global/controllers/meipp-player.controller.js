/**
 * @fileoverview Controller de players do meipp (lado do painel).
 *
 * @module modules/global/controllers/meipp-player.controller
 */

const { MeippPlayerUseCases } = require('../application/meipp/player/meipp-player.use-cases');
const { MysqlMeippPlayerRepository } = require('../infrastructure/meipp/mysql-meipp-player.repository');
const { pairingService } = require('../infrastructure/meipp/meipp-services');
const { respond } = require('../../../utils/respond');

const useCases = new MeippPlayerUseCases({
    repository: new MysqlMeippPlayerRepository(),
    pairingService,
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

/** Soft-delete: desativa o player e revoga os tokens dele. */
async function deactivate(req, res) {
    return respond.ok(res, await useCases.deactivate(Number(req.params.id)));
}

/**
 * Emite o código de pareamento.
 *
 * O código sai no corpo e é mostrado uma vez no painel. Ele não é gravado em
 * lugar nenhum — ver `meipp-pairing-code.service`.
 */
async function issuePairingCode(req, res) {
    return respond.created(res, await useCases.issuePairingCode(Number(req.params.id)));
}

async function revokeTokens(req, res) {
    return respond.ok(res, await useCases.revokeTokens(Number(req.params.id)));
}

async function enqueueCommand(req, res) {
    const result = await useCases.enqueueCommand(Number(req.params.id), req.body, req.meippUser);
    return respond.created(res, result);
}

async function listCommands(req, res) {
    return respond.ok(res, await useCases.listCommands(Number(req.params.id), req.query));
}

async function listStatusLog(req, res) {
    return respond.ok(res, await useCases.listStatusLog(Number(req.params.id), req.query));
}

module.exports = {
    list,
    getById,
    create,
    update,
    deactivate,
    issuePairingCode,
    revokeTokens,
    enqueueCommand,
    listCommands,
    listStatusLog,
};
