class GappMovimentationUseCases {

    /**
     * @param {Object} deps
     * @param {import('./ports/movimentation-repository.port').MovimentationRepositoryPort} deps.repository
     * @param {import('../ports/gapp-user-repository.port').GappUserRepositoryPort} deps.userRepository
     */

    constructor({ repository, userRepository }) {
        this.repository = repository;
        this.userRepository = userRepository;
    }

    /**
     * @throws {AppError} 404 se o usuário autenticado não estiver no GAPP.
     */
    async _resolveGappUser(currentUser) {
        const gappUser = await this.userRepository.findAuthByAccessCode(currentUser?.id);
        if (!gappUser) {
            throw new AppError('Usuário autenticado não está cadastrado no GAPP (access_code não localizado)', 404);
        }
        return gappUser;
    }

    async list() {
        const res = await this.repository.listMovimentation()
        return res
    }

    async listById(id) {
        const res = await this.repository.listMovimentationById(id)
        return res
    }

    async createMovimentation(data, user) {
        const gappUser = await this._resolveGappUser(user);

        console.log(data)
        const payload = { ...data, user_id_fk: gappUser.user_id }
        const active = { active_id: data.active_id_fk, status_active: Number(data.internal) }

        const res = await this.repository.insertMovimentation(payload, active)
        return res
    }

    async updateMovimentation(id, data, user) {
        const gappUser = await this._resolveGappUser(user);

        const isInternal = Number(data.internal)
        const isActive = Number(data.status_mov)

        const payload = { ...data, user_id_fk: gappUser.user_id, sale_value: isInternal ? 0 : data.sale_value };
        const active = {
            active_id: data.active_id_fk,
            status_active: isInternal || (!isInternal && !isActive) ? 1 : 0
        }

        const res = await this.repository.updateMovimentation(id, payload, active);

        return res
    }
}

module.exports = { GappMovimentationUseCases }