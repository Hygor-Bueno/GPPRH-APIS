const { AppError } = require('../../../../../errors/app.error');

class MgppInventoryUseCase {
    /**
        * @param {Object} deps
        * @param {import('./ports/mgpp-inventory-repository-port').MgppInventoryRepositoryPorts} deps.repository
        */
    constructor({ repository }) {
        this.repository = repository;
    }

    async _validateData(data, isUpdate) {
        const dateNow = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', });

        const config = await this.repository.getConfigs(data.id_inventory_config);
        const numberReleases = await this.repository.getNumberReleasesForMonth(dateNow, data.id_inventory_config);

        if (numberReleases >= config.quantity_for_month && !isUpdate) {
            throw new AppError('Numero de lançamentos de inventarios do mês ja foi atingido.', 400);
        }

        if (data.branch_code !== config.branch_code) {
            throw new AppError('A filial selecionada e difente da configuração.', 400);
        }

        if (data.costcenter_code !== config.costcenter_code) {
            throw new AppError('O setor selecionado e difente da configuração.', 400);
        }
    }

    async list(filters) {
        if (filters.date_start > filters.date_end) throw new AppError('Data final inferior a data de inicio', 400)
        const res = this.repository.list(filters);
        return res
    }

    async create(data, user) {
        await this._validateData(data, false);

        const payload = { ...data, id_user_fk: user.id };
        const res = this.repository.create(payload);
        return res
    }

    async update(id, data, user) {
        const status_validy = await this.repository.validateStatus(data.id_inventory);

        if (status_validy !== 0) {
            throw new AppError('Não é possível realizar alterações, pois este inventário já foi validado.', 400);
        }

        await this._validateData(data, true);

        const payload = { ...data, id_user_fk: user.id };
        const res = this.repository.update(id, payload);
        return res
    }
}

module.exports = { MgppInventoryUseCase }