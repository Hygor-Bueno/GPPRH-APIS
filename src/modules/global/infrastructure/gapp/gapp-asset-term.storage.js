/**
 * @fileoverview Arquivo do termo de ativo no `_files`.
 *
 * Usa o `FileService` como o resto do monolito (validação por magic bytes,
 * varredura de PDF, deduplicação por hash). O arquivo é servido pela rota
 * genérica `GET /global/files/:fileId` usando o `file_id_fk` do termo.
 *
 * @module modules/global/infrastructure/gapp/gapp-asset-term.storage
 */

const { AssetTermStoragePort } = require('../../application/gapp/asset-term/ports/asset-term-repository.port');
const { FileService } = require('../../../../utils/file/file.service');
const { AppError } = require('../../../../errors/app.error');

/** Nome do módulo em `_files` — também o diretório em `storage/uploads/`. */
const STORAGE_MODULE = 'GAPP';

class GappAssetTermStorage extends AssetTermStoragePort {
    async save(file, userId) {
        if (!file) throw new AppError('Nenhum arquivo recebido.', 400);
        const record = await FileService.save(file, STORAGE_MODULE, userId);
        return { fileId: Number(record.id), fileName: record.file_name || file.originalname };
    }

    async remove(fileId, userId) {
        await FileService.softDelete(Number(fileId), userId);
    }
}

module.exports = { GappAssetTermStorage, STORAGE_MODULE };
