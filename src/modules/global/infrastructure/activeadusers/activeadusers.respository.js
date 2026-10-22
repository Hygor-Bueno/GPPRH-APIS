const LDAPListUsers = require('../../../../infra/activeadusers/ldap-listusers.service');
const { ActiveAdUsersRepositoryPort } = require('../../application/activeadusers/ports/activeadusers-repository-ports');

class ActiveADUsersRepository extends ActiveAdUsersRepositoryPort {

    async list() {
        return new LDAPListUsers().listUsersActiveOnAd()
    }
}

module.exports = { ActiveADUsersRepository }