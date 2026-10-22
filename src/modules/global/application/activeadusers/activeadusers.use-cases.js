
class ActiveADUsersUseCases {
    /**
    * @param {Object} deps
    * @param {import('./ports/activeadusers-repository-ports').ActiveAdUsersRepositoryPort} deps.repository
    */
    constructor({ repository }) {
        this.repository = repository;
    }
    async listUsers() {
        return await this.repository.list()
    }
}

module.exports = { ActiveADUsersUseCases }