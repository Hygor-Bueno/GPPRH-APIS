/**
 * @fileoverview Porta do arquivo de imagem das artes do cartaz.
 * @module modules/global/application/gipp-rh/birthday/ports/birthday-flyer-art-storage.port
 */

class BirthdayFlyerArtStoragePort {
    /**
     * Dimensões do upload, ANTES de gravar — arte recusada não deixa linha em `_files`.
     *
     * @param {object} file - `req.file` do multer.
     * @returns {Promise<{ width: number, height: number }>}
     * @throws {AppError} 400 se não for PNG, JPEG ou WebP legível.
     */
    inspect(file) { throw new Error('Not implemented'); }

    /**
     * @param {object} file - `req.file` do multer.
     * @param {number} userId - `_user.id`.
     * @returns {Promise<{ fileId: number }>}
     */
    save(file, userId) { throw new Error('Not implemented'); }

    /**
     * A imagem em PNG — o `_files` guarda WebP, que PowerPoint antigo não abre.
     *
     * @param {number} fileId
     * @returns {Promise<{ buffer: Buffer, width: number, height: number }>}
     */
    readPng(fileId) { throw new Error('Not implemented'); }

    /** @returns {Promise<{ buffer: Buffer, width: number, height: number }>} a arte padrão. */
    readDefaultPng() { throw new Error('Not implemented'); }
}

module.exports = { BirthdayFlyerArtStoragePort };
