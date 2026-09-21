const { AppError } = require('../../../../../errors/app.error');

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

        const isInternal = Number(data.internal);

        const payload = {
            ...data, user_id_fk: gappUser.user_id,
            sale_value: isInternal ? 0 : data.sale_value,
            unit_id_fk: isInternal ? data.unit_id_fk : null,
            sub_dep_id_fk: isInternal ? data.sub_dep_id_fk : null
        }
        const active = { active_id: data.active_id_fk, status_active: Number(data.internal) }

        const res = await this.repository.insertMovimentation(payload, active)
        return res
    }

    async updateMovimentation(id, data, user) {
        const gappUser = await this._resolveGappUser(user);

        const isInternal = Number(data.internal);
        const isActive = Number(data.status_mov);

        const payload = {
            ...data,
            user_id_fk: gappUser.user_id,
            sale_value: isInternal ? 0 : data.sale_value,
            unit_id_fk: isInternal ? data.unit_id_fk : null,
            sub_dep_id_fk: isInternal ? data.sub_dep_id_fk : null
        };

        const active = {
            active_id: data.active_id_fk,
            status_active: isInternal || (!isInternal && !isActive) ? 1 : 0
        }
        const hasExternal = await this.repository.hasExternalMovimentation(data.active_id_fk);

        if (hasExternal && isInternal) {
            throw new AppError('Não e possivel realizar a ação, a uma movimentação externa para esse ativo!', 404)
        }

        const res = await this.repository.updateMovimentation(id, payload, active);
        return res
    }
}

module.exports = { GappMovimentationUseCases }