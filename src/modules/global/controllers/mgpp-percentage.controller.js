const { MgppPercentageUseCase } = require('../application/mgpp/percentage/mgpp-percentage.use-case');
const { MysqlPercentegeRepository } = require('../infrastructure/mgpp/mysql-percentages.repository');
const { respond } = require('../../../utils/respond');

const useCases = new MgppPercentageUseCase({
    repository: new MysqlPercentegeRepository(),
});

async function list(req, res) {
    const result = await useCases.list(req.query, req.user);
    return respond.ok(res, result);
}

async function create(req, res) {
    const result = await useCases.create(req.body, req.user);
    return respond.created(res, result);
}

async function update(req, res) {
    const result = await useCases.update(Number(req.params.id), req.body, req.user);
    return respond.ok(res, result);
}

module.exports = { list, create, update }

