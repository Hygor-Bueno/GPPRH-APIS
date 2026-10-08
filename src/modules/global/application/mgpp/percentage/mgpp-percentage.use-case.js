class MgppPercentageUseCase {
    /**
    * @param {Object} deps
    * @param {import('./ports/mgpp-percentage-repositoy-port').MgppPercentageRepositoryPort} deps.repository
    */
    constructor({ repository }) {
        this.repository = repository;
    }

    async _resolveGappUser(currentUser) {
        const gappUser = await this.userRepository.findAuthByAccessCode(currentUser?.id);
        if (!gappUser) {
            throw new AppError('Usuário autenticado não está cadastrado no GAPP (access_code não localizado)', 404);
        }
        return gappUser;
    }
    async list() {
        const res = this.repository.list();
        return res
    }

    async create(data) {

        const gappUser = await this._resolveGappUser(userId);
        const payload = { ...data, user_id_fk: gappUser.user_id };
        const res = this.repository.create(data);
        return res
    }

    async update(id, data) {
        const res = this.repository.update(id, data);
        return res
    }
}

module.exports = { MgppPercentageUseCase }