/**
 * @fileoverview Casos de uso — Ativos GAPP.
 *
 * `user_id_fk`/`work_group_fk` nunca vêm do body/query — são sempre
 * resolvidos a partir do usuário autenticado via `userRepository`.
 *
 * @module modules/global/application/gapp/active/gapp-active.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');

class GappActiveUseCases {
    /**
     * @param {Object} deps
     * @param {import('./ports/active-repository.port').ActiveRepositoryPort} deps.repository
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

    /**
     * No update, `is_vehicle` é opcional: se o cliente não mandar, mantém o
     * valor atual do ativo em vez de assumir um default.
     */
    async save(data, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);

        let isVehicle = data.is_vehicle;
        if (data.active_id && isVehicle == null) {
            const current = await this.repository.findIsVehicleByActiveId(data.active_id, gappUser.work_group_fk);
            if (!current) throw new AppError('Ativo não encontrado', 404);
            isVehicle = current.is_vehicle;
        }

        const payload = {
            ...data,
            is_vehicle: isVehicle,
            user_id_fk: gappUser.user_id,
            work_group_fk: gappUser.work_group_fk
        };

        return this.repository.saveActive(payload);
    }

    /**
     * `work_group_fk` no filtro nunca vem da query string — é sempre o grupo
     * de trabalho do usuário autenticado.
     */
    async list(filters, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        const scopedFilters = { ...filters, work_group_fk: gappUser.work_group_fk };
        return this.repository.list(scopedFilters);
    }

    /**
     * Só retorna o ativo se pertencer ao work_group_fk do usuário autenticado.
     */
    async getById(id, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);

        const active = await this.repository.findById(id, gappUser.work_group_fk);
        if (!active) throw new AppError('Ativo não encontrado', 404);

        if (active.is_vehicle === 1) {
            const vehicle = await this.repository.findVehicleByActiveId(id);
            active.vehicle = vehicle || null;
            if (active.vehicle) {
                // ! Alterar nome da função (Nome deve fazer sentido com a query - atualmente usamos o id do ativo para encontrar);
                console.log(await this.insuranceRepository.findActiveInsuranceByVehicleId(active.active_id));
                active.insurance = await this.insuranceRepository.findActiveInsuranceByVehicleId(active.active_id) || null;
            }
        }
        console.log(active)
        return active;
    }
}

module.exports = { GappActiveUseCases };
