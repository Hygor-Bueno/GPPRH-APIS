const { MgppInventoryConfigsUseCase } = require('../application/mgpp/inventory-configs/mgpp-inventory-configs.use-case');
const { MysqlInventoryConfigsRepository } = require('../infrastructure/mgpp/mysql-inventory-configs.repository');
const { respond } = require('../../../utils/respond');

const useCases = new MgppInventoryConfigsUseCase({
    repository: new MysqlInventoryConfigsRepository(),
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

