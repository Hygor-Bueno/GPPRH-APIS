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
     * @param {import('../active-identifier/gapp-active-identifier.use-cases').GappActiveIdentifierUseCases} [deps.identifierUseCases]
     *        identificadores enviados junto com o cadastro do ativo novo (`identifiers`)
     */
    constructor({ repository, userRepository, insuranceRepository, identifierUseCases }) {
        this.repository = repository;
        this.userRepository = userRepository;
        this.insuranceRepository = insuranceRepository;
        this.identifierUseCases = identifierUseCases;
    }

    /**
     * Grava o ativo. No cadastro (sem `active_id`), os `identifiers` do body são
     * validados ANTES e gravados DEPOIS (precisam do id). Se a gravação deles
     * falhar com o ativo já criado, o cadastro não é desfeito: volta 201 com
     * `identifiers_warning`, para a tela não reenviar e duplicar o ativo.
     */
    async _persist(payload, data) {
        const isNew = !data.active_id && this.identifierUseCases;
        const identifiers = isNew ? await this.identifierUseCases.prepareForNewAsset(data.identifiers) : [];
        const { identifiers: _ignored, ...activePayload } = payload;
        const saved = await this.repository.saveActive(activePayload);
        if (!identifiers.length) return saved;
        try {
            await this.identifierUseCases.addToNewAsset(saved.id, identifiers);
            return saved;
        } catch (error) {
            const reason = error?.message || 'erro ao gravar';
            return { ...saved, identifiers_warning: `Ativo #${saved.id} registrado, mas os identificadores não foram gravados (${reason}). Cadastre-os editando o ativo.` };
        }
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
        const isExists = await this.repository.findById(data.active_id, gappUser.work_group_fk)

        if (!data.status_active && !data.active_id) {
            throw new AppError("Não foi possivel realizar ação, o ativo esta desabilitado.", 400)
        }

        if (isExists && !isExists.status_active && !data.status_active) {
            throw new AppError("Não foi possivel realizar ação, o ativo esta desabilitado.", 400)
        }

        return this._persist(payload, data);
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
        }

        active.insurance = await this.insuranceRepository.findActiveInsuranceByActiveId(active.active_id) || null;

        /** 
        * Realiza a busca pelo tipo, permitindo criar novas classes derivadas das existentes 
        */
        const typeId = await this.repository.findTypeActiveById(active.id_active_class_fk)

        if (typeId.active_type_id === 5) {
            const smartphone = await this.repository.findSmartphoneByActiveId(id)
            const numbers = smartphone.sim_biding_id_fk ? await this.repository.findNumbersById(smartphone.sim_biding_id_fk) : null;
            active.smartphone = { ...smartphone, numbers: numbers }
        }

        if (typeId.active_type_id === 11) {
            const sim = await this.repository.findSimByActiveId(id);
            active.sim = sim
        }

        return active;
    }
}

module.exports = { GappActiveUseCases };
