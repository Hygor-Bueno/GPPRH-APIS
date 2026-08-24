/**
 * @fileoverview Casos de uso — Seguro GAPP.
 *
 * `save`/`list`/`getById` recebem `currentUser` e escopam por
 * `work_group_fk` do usuário autenticado — correção de uma falha de
 * autorização real (antes o serviço legado não escopava nada aqui).
 *
 * @module modules/global/application/gapp/insurance/gapp-insurance.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');

class GappInsuranceUseCases {
    /**
     * @param {Object} deps
     * @param {import('../ports/gapp-insurance-repository.port').GappInsuranceRepositoryPort} deps.repository
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

    /**
     * No create (`data.is_update` falso), valida que o veículo pertence ao
     * work_group do usuário. No update, valida que a apólice existente
     * pertence ao work_group do usuário — antes de gravar.
     *
     * @throws {AppError} 404 se veículo/apólice não existir ou for de outro grupo.
     */
    async _assertOwnership(data, workGroupFk) {
        if (!data.is_update) {
            const vehicle = await this.repository.findVehicleWorkGroup(data.vehicle_id_fk);
            if (!vehicle || vehicle.work_group_fk !== workGroupFk) {
                throw new AppError('Veículo não encontrado no seu grupo de trabalho', 404);
            }
            return;
        }

        const insurance = await this.repository.findInsuranceWorkGroup(data.id_insurance);
        if (!insurance || insurance.work_group_fk !== workGroupFk) {
            throw new AppError('Seguro não encontrado no seu grupo de trabalho', 404);
        }
    }

    async save(data, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        await this._assertOwnership(data, gappUser.work_group_fk);
        return this.repository.saveInsurancePolicy(data);
    }

    async list(filters, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        const scopedFilters = { ...filters, work_group_fk: gappUser.work_group_fk };
        return this.repository.list(scopedFilters);
    }

    async getById(id, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        const insurance = await this.repository.getById(id, gappUser.work_group_fk);
        if (!insurance) throw new AppError('Seguro não encontrado', 404);
        return insurance;
    }
}

module.exports = { GappInsuranceUseCases };
