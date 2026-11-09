/**
 * @fileoverview Porta de persistência dos moldes de termo (gapp_asset_term_template).
 *
 * @module modules/global/application/gapp/asset-term-template/ports/asset-term-template-repository.port
 */

/* eslint-disable no-unused-vars */
class AssetTermTemplateRepositoryPort {
    /** Resumo dos moldes, sem o conteúdo. @returns {Promise<object[]>} */
    async list(filters) { throw new Error('AssetTermTemplateRepositoryPort.list não implementado'); }

    /** @returns {Promise<object|null>} */
    async findById(id) { throw new Error('AssetTermTemplateRepositoryPort.findById não implementado'); }

    /** @returns {Promise<boolean>} */
    async nameExists(name, assetType, ignoreId) { throw new Error('AssetTermTemplateRepositoryPort.nameExists não implementado'); }

    /** @returns {Promise<{ insertId: number }>} */
    async insert(fields) { throw new Error('AssetTermTemplateRepositoryPort.insert não implementado'); }

    /** @returns {Promise<{ updated: number }>} */
    async update(id, fields) { throw new Error('AssetTermTemplateRepositoryPort.update não implementado'); }
}

module.exports = { AssetTermTemplateRepositoryPort };
