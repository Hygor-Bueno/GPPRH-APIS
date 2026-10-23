const LDAPUserService = require('../../../../infra/activeadusers/ldap-user-service.service');
const { ActiveDirectoryUsersRepositoryPort } = require('../../application/active-directory-users/ports/active-directory-users-repository-ports');

class ActiveDirectoryUsersRepository extends ActiveDirectoryUsersRepositoryPort {

    async listUsers() {
        return new LDAPUserService().listActiveDirectoryUsers()
    }
}

module.exports = { ActiveDirectoryUsersRepository }