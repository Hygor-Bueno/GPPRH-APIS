class MgppInventoryConfigsUseCase {
    /**
        * @param {Object} deps
        * @param {import('./ports/mgpp-percentage-repositoy-port').MgppPercentageRepositoryPort} deps.repository
        */
    constructor({ repository }) {
        this.repository = repository;
    }

    async list() {
        const res = this.repository.list();
        return res
    }

    async create(data, user) {
        const payload = { ...data, id_user_fk: user.id };
        const res = this.repository.create(payload);
        return res
    }

    async update(id, data, user) {
        const payload = { ...data, id_user_fk: user.id };
        const res = this.repository.update(id, payload);
        return res
    }
}

module.exports = { MgppInventoryConfigsUseCase }