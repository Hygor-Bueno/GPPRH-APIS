const { MgppAwardsUseCases } = require('../application/mgpp/mgpp-awards.use-case');
const { MgppAwardsRepository } = require('../infrastructure/mgpp/mysql-awards.respository');
const { respond } = require('../../../utils/respond');

const useCases = new MgppAwardsUseCases({
    repository: new MgppAwardsRepository(),
});


async function create(req, res) {
    const result = await useCases.create(req.body, req.user);
    return respond.created(res, result);
}

async function update(req, res) {
    const result = await useCases.update(Number(req.params.id), req.body, req.user);
    return respond.ok(res, result);
}

async function list(req, res) {
    const result = await useCases.list(req.query, req.user);
    return respond.ok(res, result);
}

module.exports = { list, create, update }