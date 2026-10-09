const { MgppInventoryUseCase } = require('../application/mgpp/inventory/mgpp-inventory.use-case');
const { MysqlInventoryRepository } = require('../infrastructure/mgpp/mysql-inventory.repository');
const { respond } = require('../../../utils/respond');

const useCases = new MgppInventoryUseCase({
    repository: new MysqlInventoryRepository(),
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

