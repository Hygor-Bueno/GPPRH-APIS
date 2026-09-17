const { GappMovimentationUseCases } = require('../application/gapp/movimentation/gapp-movimentation.use-case');
const { MysqlMovimentationRepository } = require('../infrastructure/gapp/mysql-gapp-movimentation.repository');
const { MysqlGappUserRepository } = require('../infrastructure/gapp/mysql-gapp-user.repository');
const { respond } = require('../../../utils/respond');

const useCases = new GappMovimentationUseCases({
    repository: new MysqlMovimentationRepository(),
    userRepository: new MysqlGappUserRepository(),
});


async function list(req, res) {
    const result = await useCases.list(req.query, req.user);
    return respond.ok(res, result);
}

async function listById(req, res) {
    const result = await useCases.listById(Number(req.params.id), req.body, req.user);
    return respond.ok(res, result);
}

async function createMovimentation(req, res) {
    const result = await useCases.createMovimentation(req.body, req.user);
    return respond.created(res, result);
}

async function updateMovimentation(req, res) {
    const result = await useCases.updateMovimentation(Number(req.params.id), req.body, req.user);
    return respond.ok(res, result);
}

module.exports = { list, listById, createMovimentation, updateMovimentation }