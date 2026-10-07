class MgppAwardsUseCases {

    /**
     * @param {Object} deps
     * @param {import('./ports/mgpp-awards-repository-ports').MgppAwardsRepositoryPorts} deps.repository
     */
    constructor({ repository }) {
        this.repository = repository;
    }

    async list() {
        const res = this.repository.list();
        return res
    }

    async create(data) {
        const res = this.repository.create(data);
        return res
    }

    async update(id, data) {
        const res = this.repository.update(id, data);
        return res
    }
}

module.exports = { MgppAwardsUseCases }