const { AppError } = require('../../../../../errors/app.error');

class MgppPercentageUseCase {
    /**
    * @param {Object} deps
    * @param {import('./ports/mgpp-percentage-repositoy-port').MgppPercentageRepositoryPort} deps.repository
    */
    constructor({ repository }) {
        this.repository = repository;
    }

    async _validatePercentage(branchCode, costcenterCode, newPercentage, isUpdate) {
        const totalPecentage = await this.repository.getTotalpercentageSector(branchCode, costcenterCode);
        if (totalPecentage >= 100 || (Number(newPercentage) + Number(totalPecentage)) > 100) throw new AppError(`A soma dos percentuais dos setores deve ser igual a 100%. Total atual: ${totalPecentage}%.`, 400)
    }

    async list() {
        const res = this.repository.list();
        return res
    }

    async create(data, user) {
        await this._validatePercentage(data.branch_code, data.costcenter_code, data.value_sector_percentage);
        const payload = { ...data, id_user_fk: user.id };
        const res = this.repository.create(payload);
        return res
    }

    async update(id, data, user) {
        await this._validatePercentage(data.branch_code, data.costcenter_code, data.value_sector_percentage, true);
        const payload = { ...data, id_user_fk: user.id };
        const res = this.repository.update(id, payload);
        return res
    }
}

module.exports = { MgppPercentageUseCase }