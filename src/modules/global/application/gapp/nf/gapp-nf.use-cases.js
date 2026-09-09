

class GappNfUseCases {
    /**
     * @param {Object} deps
     * @param {import('./ports/nf-repository.port').NfRepositoryPort} deps.repository
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

    async list(filters) {
        const res = this.repository.listNf(filters);
        return res
    }

    async listByid(filters) {
        const res = this.repository.listByid(filters)
    }

    async createNf(data, userId) {
        const gappUser = await this._resolveGappUser(userId);
        const payload = { ...data, user_id_fk: gappUser.user_id };

        return this.repository.createNf(payload);
    }

    async updateNf(id, data, user) {
        const gappUser = await this._resolveGappUser(user);

        // const current = await this.repository.findExpenseType(id); // adicionar validação
        // if (!current) throw new AppError('Despesa não encontrada', 404);
        // if (Number(current.exp_type_id_fk) !== Number(data.exp_type_id_fk)) {
        //     throw new AppError("Não é possível alterar o tipo de uma despesa já registrada ('exp_type_id_fk')", 400);
        // }

        const payload = { ...data };

        return this.repository.updateNf(id, payload);
    }
}

module.exports = { GappNfUseCases }