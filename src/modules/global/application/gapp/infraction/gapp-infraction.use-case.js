class GappInfractionUseCases {

    /**
     * @param {Object} deps
     * @param {import('./ports/infraction-repository.port').InfractionRepositoryPort} deps.repository
     * @param {import('../ports/gapp-user-repository.port').GappUserRepositoryPort} deps.userRepository
     */
    constructor({ repository, userRepository }) {
        this.repository = repository;
        this.userRepository = userRepository;
    }

    async list() {
        const res = await this.repository.listInfraction()
        return res
    }

    async listById(id) {
        const res = await this.repository.listInfractionById(id)
        return res
    }

    async createInfraction(payload) {
        const res = await this.repository.insertInfraction(payload)
        return res
    }

    async updateInfraction(id, data) {

        const payload = { ...data, infraction_id: id }

        const res = await this.repository.updateInfraction(id, payload)
        return res
    }
}

module.exports = { GappInfractionUseCases }