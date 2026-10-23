
class ActiveDirectoryUsersUseCases {
    /**
    * @param {Object} deps
    * @param {import('./ports/active-directory-users-repository-ports').ActiveDirectoryUsersRepositoryPort} deps.repository
    */
    constructor({ repository }) {
        this.repository = repository;
    }
    async listUsers() {
        return await this.repository.listUsers()
    }
}

module.exports = { ActiveDirectoryUsersUseCases }