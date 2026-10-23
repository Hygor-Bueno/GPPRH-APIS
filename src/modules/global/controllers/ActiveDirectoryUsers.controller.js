const { ActiveDirectoryUsersUseCases } = require('../application/active-directory-users/active-directory-users.use-cases');
const { ActiveDirectoryUsersRepository } = require('../infrastructure/activeadusers/active-directory-users.respository');
const { respond } = require('../../../utils/respond');

const useCases = new ActiveDirectoryUsersUseCases({
    repository: new ActiveDirectoryUsersRepository(),
});

async function listActiveDirectoryUsers(req, res) {
    const result = await useCases.listUsers();
    return respond.ok(res, result);
}

module.exports = { listActiveDirectoryUsers }