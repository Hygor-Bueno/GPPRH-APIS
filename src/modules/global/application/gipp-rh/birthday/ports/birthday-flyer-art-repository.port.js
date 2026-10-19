/**
 * @fileoverview Porta das artes do cartaz por empresa (`rh_birthday_flyer_arts`, MySQL `global`).
 * @module modules/global/application/gipp-rh/birthday/ports/birthday-flyer-art-repository.port
 */

/**
 * @typedef {object} FlyerArtRow
 * @property {string} company_code - '02'.
 * @property {number} file_id - `_files.id` da imagem.
 * @property {number} image_width
 * @property {number} image_height
 * @property {object} layout - ver `DEFAULT_LAYOUT` em `birthday-flyer-art.rules`.
 * @property {Date} updated_at
 * @property {number} updated_by - `_user.id`.
 */

class BirthdayFlyerArtRepositoryPort {
    /** @returns {Promise<FlyerArtRow[]>} */
    list() { throw new Error('Not implemented'); }

    /**
     * @param {string} companyCode
     * @returns {Promise<?FlyerArtRow>}
     */
    findByCompany(companyCode) { throw new Error('Not implemented'); }

    /**
     * Cria ou substitui a arte da empresa.
     *
     * @param {{ companyCode: string, fileId: number, imageWidth: number, imageHeight: number,
     *           layout: object, userId: number }} art
     */
    upsert(art) { throw new Error('Not implemented'); }

    /**
     * @param {string} companyCode
     * @returns {Promise<boolean>} `false` se a empresa já estava na arte padrão.
     */
    remove(companyCode) { throw new Error('Not implemented'); }
}

module.exports = { BirthdayFlyerArtRepositoryPort };
