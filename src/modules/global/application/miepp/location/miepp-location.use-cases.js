/**
 * @fileoverview Casos de uso de locais (`miepp_locations`).
 *
 * @module modules/global/application/miepp/location/miepp-location.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { normalizePagination, optionalFlag, paginated } = require('../../../domain/miepp/pagination.rules');

class MieppLocationUseCases {
    /**
     * @param {object} deps
     * @param {import('./ports/location-repository.port').LocationRepositoryPort} deps.repository
     */
    constructor({ repository }) {
        this.repository = repository;
    }

    /** @private @returns {Promise<object>} 404 se não existir. */
    async _requireLocation(id) {
        const location = await this.repository.findById(id);
        if (!location) throw new AppError('Local não encontrado.', 404);
        return location;
    }

    async list(query = {}) {
        const pagination = normalizePagination(query);
        const { rows, total } = await this.repository.list({
            ...pagination,
            active: optionalFlag(query.active),
        });
        return paginated(rows, total, pagination);
    }

    async getById(id) {
        return this._requireLocation(id);
    }

    async create(payload) {
        const id = await this.repository.create({
            name: payload.name,
            address: payload.address ?? null,
            type: payload.type,
            active: payload.active === undefined ? 1 : Number(payload.active),
        });
        return this.repository.findById(id);
    }

    async update(id, payload) {
        const current = await this._requireLocation(id);

        await this.repository.update(id, {
            name: payload.name ?? current.name,
            address: payload.address === undefined ? current.address : payload.address,
            type: payload.type ?? current.type,
            active: payload.active === undefined ? current.active : Number(payload.active),
        });

        return this.repository.findById(id);
    }

    /**
     * Remoção física. Os players do local ficam com `location_id = NULL`
     * (ON DELETE SET NULL), então nenhuma tela é perdida junto — por isso aqui
     * não há guarda de uso como em playlist e mídia.
     */
    async remove(id) {
        await this._requireLocation(id);
        await this.repository.remove(id);
        return { id: Number(id) };
    }
}

module.exports = { MieppLocationUseCases };
