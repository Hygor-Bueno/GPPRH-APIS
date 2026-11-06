/**
 * @fileoverview Casos de uso dos termos de ativo (gapp_asset_term).
 *
 * Consistência entre o registro e o arquivo:
 * - Tudo que pode recusar a operação (termo/ativo inexistente, arquivo ausente)
 *   é validado ANTES de gravar o arquivo.
 * - Troca de arquivo: o termo passa a apontar para o novo e só então o antigo é liberado.
 * - Exclusão: a linha sai primeiro e só então o arquivo é liberado — nunca existe
 *   termo apontando para arquivo removido.
 * - O `FileService` deduplica por hash: o mesmo arquivo pode estar em mais de um
 *   termo. Só é liberado quando nenhum outro termo o referencia.
 *
 * @module modules/global/application/gapp/asset-term/gapp-asset-term.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');

class GappAssetTermUseCases {
    /**
     * @param {{ repository: import('./ports/asset-term-repository.port').AssetTermRepositoryPort,
     *           storage: import('./ports/asset-term-repository.port').AssetTermStoragePort }} deps
     */
    constructor({ repository, storage }) {
        this.repository = repository;
        this.storage = storage;
    }

    async listAssetTerms(filters = {}) {
        return this.repository.list(filters);
    }

    async getAssetTermById(id) {
        const term = await this.repository.findById(Number(id));
        if (!term) throw new AppError('Termo não encontrado.', 404);
        return term;
    }

    async createAssetTerm(data, file, userId) {
        if (!file) throw new AppError('O arquivo do termo é obrigatório.', 400);
        await this._assertActiveExists(data.active_id_fk);

        const stored = await this.storage.save(file, userId);
        const { insertId } = await this.repository.insert({
            reponsible_name: data.reponsible_name,
            created_by: userId,
            active_id_fk: data.active_id_fk,
            file_id_fk: stored.fileId,
            file_name: stored.fileName,
        });
        return this.getAssetTermById(insertId);
    }

    async updateAssetTerm(id, data, file, userId) {
        const current = await this.getAssetTermById(id);
        if (data.active_id_fk != null) await this._assertActiveExists(data.active_id_fk);

        // Campos não enviados mantêm o valor atual; arquivo só muda se vier um novo
        const stored = file ? await this.storage.save(file, userId) : null;
        await this.repository.update(current.asset_term_id, {
            reponsible_name: data.reponsible_name ?? current.reponsible_name,
            active_id_fk: data.active_id_fk ?? current.active_id_fk,
            file_id_fk: stored?.fileId ?? current.file_id_fk,
            file_name: stored?.fileName ?? current.file_name,
        });

        if (stored && stored.fileId !== current.file_id_fk) {
            await this._releaseFile(current.file_id_fk, current.asset_term_id, userId);
        }
        return this.getAssetTermById(current.asset_term_id);
    }

    async deleteAssetTerm(id, userId) {
        const current = await this.getAssetTermById(id);
        await this.repository.delete(current.asset_term_id);
        await this._releaseFile(current.file_id_fk, current.asset_term_id, userId);
    }

    /** @private */
    async _assertActiveExists(activeId) {
        if (!(await this.repository.activeExists(activeId))) {
            throw new AppError('Ativo não encontrado.', 404);
        }
    }

    /**
     * Libera (soft-delete) o arquivo que deixou de ser usado pelo termo.
     * Falha aqui não desfaz a operação principal: o termo já está consistente,
     * no máximo sobra um arquivo sem referência.
     * @private
     */
    async _releaseFile(fileId, assetTermId, userId) {
        if (!fileId) return;
        try {
            if (await this.repository.countFileReferences(fileId, assetTermId) > 0) return;
            await this.storage.remove(fileId, userId);
        } catch (error) {
            console.error(`[gapp-asset-term] Falha ao liberar o arquivo ${fileId}:`, error.message);
        }
    }
}

module.exports = { GappAssetTermUseCases };
