const { AppError } = require('../../../../../errors/app.error');

class MgppInventoryUseCase {
    /**
        * @param {Object} deps
        * @param {import('./ports/mgpp-inventory-repository-port').MgppInventoryRepositoryPorts} deps.repository
        */
    constructor({ repository }) {
        this.repository = repository;
    }

    async _validateData(data) {
        const dateNow = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', });

        const config = await this.repository.getConfigs(data.id_inventory_config);
        const numberReleases = await this.repository.getNumberReleasesForMonth(dateNow, data.id_inventory_config);

        if (numberReleases >= config.quantity_for_month) {
            throw new AppError('Numero de lançamentos de inventarios do mês ja foi atingido.', 400);
        }

        if (data.branch_code !== config.branch_code) {
            throw new AppError('A filial selecionada e difente da configuração.', 400);
        }

        if (data.costcenter_code !== config.costcenter_code) {
            throw new AppError('O setor selecionado e difente da configuração.', 400);
        }
    }

    async list() {
        const res = this.repository.list();
        return res
    }

    async create(data, user) {
        await this._validateData(data);

        const payload = { ...data, id_user_fk: user.id };
        const res = this.repository.create(payload);
        return res
    }

    async update(id, data, user) {
        await this._validateData(data);

        const payload = { ...data, id_user_fk: user.id };
        const res = this.repository.update(id, payload);
        return res
    }
}

module.exports = { MgppInventoryUseCase }