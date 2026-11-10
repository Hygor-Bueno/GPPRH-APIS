/**
 * @fileoverview Portas da migração TEMPORÁRIA de termos do legado.
 *
 * `TermMigrationRepositoryPort`: tabela de controle + leitura do legado
 * (`GIPP.gs_smartphone`) e da base nova (`gapp_smartphone`).
 * `TermMigrationSourcePort`: pasta de origem dos arquivos (somente leitura).
 *
 * O cadastro do termo em si NÃO tem porta própria: é o `GappAssetTermUseCases`
 * de sempre (FileService + `gapp_asset_term`), injetado como `termCreator`.
 *
 * @module modules/global/application/gapp/term-migration/ports/term-migration.ports
 */

/* eslint-disable no-unused-vars */
class TermMigrationRepositoryPort {
    /** @returns {Promise<Set<string>>} */
    async findKnownPaths(paths) { throw new Error('TermMigrationRepositoryPort.findKnownPaths não implementado'); }
    /** Nunca derruba o lote por causa de uma linha. @returns {Promise<{ inserted: number, failed: { source_path: string, reason: string }[] }>} */
    async insertScanned(rows) { throw new Error('TermMigrationRepositoryPort.insertScanned não implementado'); }
    /** @returns {Promise<{ migration_id: number, status: string, message: string|null }[]>} */
    async findIdsByPaths(paths) { throw new Error('TermMigrationRepositoryPort.findIdsByPaths não implementado'); }

    /** @returns {Promise<object[]>} */
    async selectBatch({ statuses, ids, limit }) { throw new Error('TermMigrationRepositoryPort.selectBatch não implementado'); }
    /** @returns {Promise<object[]>} */
    async selectRetryBatch({ ids, limit }) { throw new Error('TermMigrationRepositoryPort.selectRetryBatch não implementado'); }

    /** @returns {Promise<Map<number, { codigo: number, imei1: string|null, imei2: string|null }>>} */
    async findLegacySmartphones(codes) { throw new Error('TermMigrationRepositoryPort.findLegacySmartphones não implementado'); }
    /** @returns {Promise<{ active_id: number, imei_1: string|null, imei_2: string|null }[]>} */
    async findSmartphonesByImeis(imeis) { throw new Error('TermMigrationRepositoryPort.findSmartphonesByImeis não implementado'); }
    /** @returns {Promise<boolean>} */
    async isSmartphoneAsset(activeId) { throw new Error('TermMigrationRepositoryPort.isSmartphoneAsset não implementado'); }
    /** @returns {Promise<{ asset_term_id: number, file_id_fk: number }|null>} */
    async findExistingTerm(activeId, fileHash, fileNames) { throw new Error('TermMigrationRepositoryPort.findExistingTerm não implementado'); }

    /** Todas as transições são condicionadas ao status anterior. @returns {Promise<boolean>} aplicou? */
    async applyValidation(migrationId, expectedStatus, result, userId) { throw new Error('TermMigrationRepositoryPort.applyValidation não implementado'); }
    async claimForMigration(migrationId, userId) { throw new Error('TermMigrationRepositoryPort.claimForMigration não implementado'); }
    async markMigrated(migrationId, data, userId) { throw new Error('TermMigrationRepositoryPort.markMigrated não implementado'); }
    async markFailed(migrationId, data, userId) { throw new Error('TermMigrationRepositoryPort.markFailed não implementado'); }
    async resetToPending(migrationId, expectedStatus, userId) { throw new Error('TermMigrationRepositoryPort.resetToPending não implementado'); }
    async ignore(migrationId, message, userId) { throw new Error('TermMigrationRepositoryPort.ignore não implementado'); }
    async restore(migrationId, userId) { throw new Error('TermMigrationRepositoryPort.restore não implementado'); }

    /** @returns {Promise<{ byStatus: object[], byIssue: object[] }>} */
    async summary() { throw new Error('TermMigrationRepositoryPort.summary não implementado'); }
    /** @returns {Promise<{ rows: object[], total: number }>} */
    async list(filters, pagination) { throw new Error('TermMigrationRepositoryPort.list não implementado'); }
    async findById(migrationId) { throw new Error('TermMigrationRepositoryPort.findById não implementado'); }
    async listLogs(migrationId) { throw new Error('TermMigrationRepositoryPort.listLogs não implementado'); }
    /** Nunca lança. */
    async insertLogs(entries) { throw new Error('TermMigrationRepositoryPort.insertLogs não implementado'); }
}

class TermMigrationSourcePort {
    /** @returns {{ configured: boolean, env: string, root: string|null }} */
    describe() { throw new Error('TermMigrationSourcePort.describe não implementado'); }
    /** @returns {Promise<{ relativePath: string, fileName: string, size: number, modifiedAt: Date }[]>} */
    async list() { throw new Error('TermMigrationSourcePort.list não implementado'); }
    /** @returns {Promise<{ file: object, sha256: string, fileNames: string[] }>} */
    async read(relativePath) { throw new Error('TermMigrationSourcePort.read não implementado'); }
    /** @returns {Promise<boolean>} */
    async exists(relativePath) { throw new Error('TermMigrationSourcePort.exists não implementado'); }
}

module.exports = { TermMigrationRepositoryPort, TermMigrationSourcePort };
