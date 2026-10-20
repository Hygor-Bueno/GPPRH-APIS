/**
 * @fileoverview Imagem da arte do cartaz — implementa `BirthdayFlyerArtStoragePort`.
 *
 * O upload passa pelo `FileService` como o resto do monolito (magic bytes,
 * remoção de EXIF, deduplicação por hash), o que converte PNG/JPEG em WebP.
 * PowerPoint antigo não abre WebP, então na hora de montar o `.pptx` a imagem
 * volta a PNG aqui. A arte padrão é o PNG versionado no repositório.
 *
 * ⚠️ Nunca dar soft-delete na imagem antiga ao trocar a arte: o `FileService`
 *    deduplica pelo hash, e a mesma linha de `_files` pode ser a arte de outra
 *    empresa.
 *
 * @module modules/global/infrastructure/gipp-rh/birthday-flyer-art.storage
 */

const fs = require('fs/promises');
const path = require('path');

const { BirthdayFlyerArtStoragePort } = require('../../application/gipp-rh/birthday/ports/birthday-flyer-art-storage.port');
const { FileService } = require('../../../../utils/file/file.service');
const { AppError } = require('../../../../errors/app.error');
const { FlyerArtErrorCode, DEFAULT_IMAGE } = require('../../domain/gipp-rh/birthday-flyer-art.rules');

/** Nome do módulo em `_files` — também o diretório em `storage/uploads/`. */
const STORAGE_MODULE = 'GIPPRH';

const DEFAULT_BACKGROUND = path.resolve(__dirname, '../../../../templates/birthday-flyer/background.png');

const ACCEPTED_FORMATS = new Set(['png', 'jpeg', 'webp']);

function invalidImage(message) {
    return new AppError(message, 400, { code: FlyerArtErrorCode.InvalidImage });
}

class BirthdayFlyerArtStorage extends BirthdayFlyerArtStoragePort {
    async inspect(file) {
        if (!file || (!file.buffer && !file.path)) {
            throw new AppError('Envie a imagem da arte no campo `file`.', 400, {
                code: FlyerArtErrorCode.FileRequired,
            });
        }
        const sharp = require('sharp');
        let metadata;
        try {
            metadata = await sharp(file.buffer ?? file.path).metadata();
        } catch {
            throw invalidImage('O arquivo enviado não é uma imagem legível. Use PNG ou JPEG.');
        }
        if (!ACCEPTED_FORMATS.has(metadata.format)) {
            throw invalidImage('A arte precisa ser PNG ou JPEG.');
        }
        return { width: metadata.width, height: metadata.height };
    }

    async save(file, userId) {
        const record = await FileService.save(file, STORAGE_MODULE, userId);
        return { fileId: Number(record.id) };
    }

    async readPng(fileId) {
        let absolutePath;
        try {
            absolutePath = FileService.absolutePath(await FileService.findById(Number(fileId)));
        } catch (error) {
            throw new AppError('A imagem desta arte não foi encontrada no armazenamento. Envie a arte de novo.', 500, {
                code: FlyerArtErrorCode.ImageMissing,
                details: error,
            });
        }
        const sharp = require('sharp');
        const { data, info } = await sharp(absolutePath).png().toBuffer({ resolveWithObject: true });
        return { buffer: data, width: info.width, height: info.height };
    }

    async readDefaultPng() {
        const buffer = await fs.readFile(DEFAULT_BACKGROUND);
        return { buffer, width: DEFAULT_IMAGE.width, height: DEFAULT_IMAGE.height };
    }
}

module.exports = { BirthdayFlyerArtStorage, STORAGE_MODULE };
