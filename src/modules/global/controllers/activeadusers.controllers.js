const { ActiveADUsersUseCases } = require('../application/activeadusers/activeadusers.use-cases');
const { ActiveADUsersRepository } = require('../infrastructure/activeadusers/activeadusers.respository');
const { respond } = require('../../../utils/respond');

const useCases = new ActiveADUsersUseCases({
    repository: new ActiveADUsersRepository(),
});

async function listActiveADUsers(req, res) {
    const result = await useCases.listUsers();
    return respond.ok(res, result);
}

module.exports = { listActiveADUsers }