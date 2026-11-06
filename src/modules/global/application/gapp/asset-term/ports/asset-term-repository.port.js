/**
 * @fileoverview Portas do módulo de termos de ativo (GAPP).
 *
 * `AssetTermRepositoryPort`: persistência de `gapp_asset_term`.
 * `AssetTermStoragePort`: arquivo do termo no `_files` (via FileService).
 *
 * @module modules/global/application/gapp/asset-term/ports/asset-term-repository.port
 */

/* eslint-disable no-unused-vars */
class AssetTermRepositoryPort {
    /** @returns {Promise<{ items: object[], total: number, page: number, limit: number }>} */
    async list(filters) { throw new Error('AssetTermRepositoryPort.list não implementado'); }

    /** @returns {Promise<object|null>} */
    async findById(id) { throw new Error('AssetTermRepositoryPort.findById não implementado'); }

    /** @returns {Promise<boolean>} */
    async activeExists(activeId) { throw new Error('AssetTermRepositoryPort.activeExists não implementado'); }

    /** Quantos outros termos (exceto `ignoreAssetTermId`) usam o arquivo. @returns {Promise<number>} */
    async countFileReferences(fileId, ignoreAssetTermId) { throw new Error('AssetTermRepositoryPort.countFileReferences não implementado'); }

    /** @returns {Promise<{ insertId: number }>} */
    async insert(fields) { throw new Error('AssetTermRepositoryPort.insert não implementado'); }

    /** @returns {Promise<{ updated: number }>} */
    async update(id, fields) { throw new Error('AssetTermRepositoryPort.update não implementado'); }

    /** @returns {Promise<{ deleted: number }>} */
    async delete(id) { throw new Error('AssetTermRepositoryPort.delete não implementado'); }
}

class AssetTermStoragePort {
    /** @returns {Promise<{ fileId: number, fileName: string }>} */
    async save(file, userId) { throw new Error('AssetTermStoragePort.save não implementado'); }

    /** Soft-delete do arquivo em `_files`. @returns {Promise<void>} */
    async remove(fileId, userId) { throw new Error('AssetTermStoragePort.remove não implementado'); }
}

module.exports = { AssetTermRepositoryPort, AssetTermStoragePort };
