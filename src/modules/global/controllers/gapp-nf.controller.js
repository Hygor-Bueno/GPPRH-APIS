const { GappNfUseCases } = require('../application/gapp/nf/gapp-nf.use-cases');
const { MysqlNfRepository } = require('../infrastructure/gapp/mysql-gapp-nf.repository');
const { MysqlGappUserRepository } = require('../infrastructure/gapp/mysql-gapp-user.repository');
const { respond } = require('../../../utils/respond');

const useCases = new GappNfUseCases({
    repository: new MysqlNfRepository(),
    userRepository: new MysqlGappUserRepository(),
});


async function createNf(req, res) {
    const result = await useCases.createNf(req.body, req.user);
    return respond.created(res, result);
}

async function updateNf(req, res) {
    const result = await useCases.updateNf(Number(req.params.id), req.body, req.user);
    return respond.ok(res, result);
}

async function listNf(req, res) {
    const result = await useCases.list(req.query, req.user);
    return respond.ok(res, result);
}

async function listNfById(req, res) {
    const result = await useCases.listByid(Number(req.params.id), req.body, req.user);
    return respond.ok(res, result);
}

async function listCoupon(req, res) {
    const result = await useCases.listCoupon(req.query, req.user);
    return respond.ok(res, result);
}

async function deleteNF(req, res) {
    const result = await useCases.deleteNF(Number(req.params.id), req.body, req.user);
    return respond.ok(res, result);
}
module.exports = { createNf, updateNf, listNf, listNfById, listCoupon, deleteNF }