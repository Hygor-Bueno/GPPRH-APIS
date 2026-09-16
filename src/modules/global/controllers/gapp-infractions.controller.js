const { GappInfractionUseCases } = require('../application/gapp/infraction/gapp-infraction.use-case');
const { MysqlInfractionRepository } = require('../infrastructure/gapp/mysql-infraction.repository');
const { MysqlGappUserRepository } = require('../infrastructure/gapp/mysql-gapp-user.repository');
const { respond } = require('../../../utils/respond');

const useCases = new GappInfractionUseCases({
    repository: new MysqlInfractionRepository(),
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

async function createInfraction(req, res) {
    const result = await useCases.createInfraction(req.body, req.user);
    return respond.created(res, result);
}

async function updateInfraction(req, res) {
    const result = await useCases.updateInfraction(Number(req.params.id), req.body, req.user);
    return respond.ok(res, result);
}

module.exports = { list, listById, createInfraction, updateInfraction }