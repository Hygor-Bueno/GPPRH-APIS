/**
 * @fileoverview Anexo de ajuste (atestado, declaração) no `_files`.
 *
 * Usa o `FileService` como o resto do monolito — validação por magic bytes,
 * varredura de PDF, remoção de EXIF. Consequência aceita: foto (PNG/JPEG) é
 * convertida para WebP; PDF fica como veio.
 *
 * ⚠️ Atestado é dado de saúde (LGPD, art. 11). A rota genérica
 *    `GET /global/files/:fileId` serve qualquer arquivo a qualquer usuário
 *    logado; por isso o módulo `CPPP` está em `RESTRICTED_MODULES` do
 *    `files.controller`, e o anexo só sai por
 *    `GET /cppp/adjustments/:id/attachment`, com permissão.
 *
 * @module modules/global/infrastructure/cppp/cppp-attachment.storage
 */

const path = require('path');

const { CpppAttachmentStoragePort } = require('../../application/cppp/ports/cppp-external.ports');
const { FileService } = require('../../../../utils/file/file.service');
const { AppError } = require('../../../../errors/app.error');

/** Nome do módulo em `_files` — também o diretório em `storage/uploads/`. */
const STORAGE_MODULE = 'CPPP';

class CpppAttachmentStorage extends CpppAttachmentStoragePort {
    async save(file, userId) {
        if (!file) throw new AppError('Nenhum arquivo recebido.', 400);
        const record = await FileService.save(file, STORAGE_MODULE, userId);
        return { fileId: Number(record.id), mimeType: record.file_type };
    }

    async resolve(fileId) {
        const record = await FileService.findById(Number(fileId));
        return {
            absolutePath: FileService.absolutePath(record),
            fileName: record.file_name || path.basename(record.file_path),
            mimeType: record.file_type,
        };
    }
}

module.exports = { CpppAttachmentStorage, STORAGE_MODULE };
