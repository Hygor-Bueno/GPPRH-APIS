class GappSettingsUseCases {

    /**
     * @param {Object} deps
     * @param {import('./ports/settings-repository.port').SettingsRepositoryPort} deps.repository
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

    async createActiveType(data, user) {
        const gappUser = await this._resolveGappUser(user);

        const payload = {
            ...data, group_id_fk: gappUser.work_group_fk
        }

        const res = await this.repository.insertActiveType(payload);
        return res
    }

    async createActiveClass(data, user) {
        const res = await this.repository.insertActiveClass(data);
        return res
    }

    async createCompany(data, user) {
        const res = await this.repository.insertCompany(data);
        return res
    }

    async createUnit(data, user) {
        const res = await this.repository.insertUnit(data);
        return res
    }

    async createDepartament(data, user) {
        const res = await this.repository.insertDepartament(data);
        return res
    }

    async createSubdepartament(data, user) {
        const res = await this.repository.insertSubdeparment(data);
        return res
    }

    // UPDATES
    async updateActiveType(id, data, user) {
        const gappUser = await this._resolveGappUser(user);

        const payload = {
            ...data, group_id_fk: gappUser.work_group_fk
        }

        const res = await this.repository.updateActiveType(payload, id);
        return res
    }

    async updateActiveClass(id, data, user) {
        const res = await this.repository.updateActiveClass(data, id);
        return res
    }

    async updateCompany(id, data, user) {
        const res = await this.repository.updateCompany(data, id);
        return res
    }

    async updateUnit(id, data, user) {
        const res = await this.repository.updateUnit(data, id);
        return res
    }

    async updateDepartament(id, data, user) {
        const res = await this.repository.updateDepartament(data, id);
        return res
    }

    async updateSubdepartament(id, data, user) {
        const res = await this.repository.updateSubdeparment(data, id);
        return res
    }

}

module.exports = { GappSettingsUseCases }