const { OperatorUseCases } = require('../application/gapp/operator/gapp-operator.use-cases');
const { MysqlOperatorRepository } = require('../infrastructure/gapp/mysql-operator.repository');
const { MysqlGappUserRepository } = require('../infrastructure/gapp/mysql-gapp-user.repository');
const { respond } = require('../../../utils/respond');

const useCases = new OperatorUseCases({
    repository: new MysqlOperatorRepository(),
    userRepository: new MysqlGappUserRepository(),
});


async function listOperators(req, res) {
    const result = await useCases.listOperators(req.query, req.user);
    return respond.ok(res, result);
}

async function createOperator(req, res) {
    const result = await useCases.createOperator(req.body.name, req.user);
    return respond.ok(res, result);
}

async function updateOperator(req, res) {
    const result = await useCases.updateOperator(req.body.name, Number(req.params.id), req.user);
    return respond.ok(res, result);
}

module.exports = {
    listOperators,
    createOperator,
    updateOperator
}