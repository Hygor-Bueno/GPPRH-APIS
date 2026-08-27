/**
 * @fileoverview Casos de uso — Veículos GAPP.
 *
 * `list`/`getById` recebem `currentUser` e escopam por `work_group_fk` do
 * usuário autenticado — correção de uma falha de autorização real (antes o
 * serviço legado não escopava nada aqui).
 *
 * @module modules/global/application/gapp/vehicle/gapp-vehicle.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');

class GappVehicleUseCases {
    /**
     * @param {Object} deps
     * @param {import('./ports/vehicle-repository.port').VehicleRepositoryPort} deps.repository
     * @param {import('../ports/gapp-user-repository.port').GappUserRepositoryPort} deps.userRepository
     * @param {import('../ports/gapp-insurance-repository.port').GappInsuranceRepositoryPort} deps.insuranceRepository
     */
    constructor({ repository, userRepository, insuranceRepository }) {
        this.repository = repository;
        this.userRepository = userRepository;
        this.insuranceRepository = insuranceRepository;
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

    async list(filters, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        const scopedFilters = { ...filters, work_group_fk: gappUser.work_group_fk };
        return this.repository.list(scopedFilters);
    }

    async getById(id, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);

        const vehicle = await this.repository.findById(id, gappUser.work_group_fk);
        if (!vehicle) throw new AppError('Veículo não encontrado', 404);

        vehicle.insurance = await this.insuranceRepository.findActiveInsuranceByVehicleId(vehicle.vehicle_id) || null;
        return vehicle;
    }
}

module.exports = { GappVehicleUseCases };
