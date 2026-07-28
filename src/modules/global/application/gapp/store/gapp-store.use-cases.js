/**
 * @fileoverview Casos de uso — Lojas GAPP.
 *
 * @module modules/global/application/gapp/store/gapp-store.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');

class GappStoreUseCases {
    /** @param {{repository: import('./ports/store-repository.port').StoreRepositoryPort}} deps */
    constructor({ repository }) {
        this.repository = repository;
    }

    async listStores(filters) {
        return this.repository.list(filters);
    }

    /** @throws {AppError} 404 se a loja não existir. */
    async getStoreById(id) {
        const store = await this.repository.findById(id);
        if (!store) throw new AppError('Loja não encontrada', 404);
        return store;
    }

    async createStore(data) {
        const { insertId } = await this.repository.insert(data);
        return this.getStoreById(insertId);
    }

    /** @throws {AppError} 404 se a loja não existir. */
    async updateStore(id, data) {
        const exists = await this.repository.storeExists(id);
        if (!exists) throw new AppError('Loja não encontrada', 404);

        await this.repository.update(id, data);
        return this.getStoreById(id);
    }

    /**
     * Exclusão lógica — nunca remove a linha, só desativa via status_store.
     * @throws {AppError} 404 se a loja não existir.
     */
    async deleteStore(id) {
        const exists = await this.repository.storeExists(id);
        if (!exists) throw new AppError('Loja não encontrada', 404);

        await this.repository.softDeleteStore(id);
        return { deleted: true };
    }
}

module.exports = { GappStoreUseCases };
