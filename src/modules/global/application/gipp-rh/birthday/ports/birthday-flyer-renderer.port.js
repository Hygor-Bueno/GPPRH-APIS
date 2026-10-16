/**
 * @fileoverview Porta de geração do cartaz de aniversariantes.
 * @module modules/global/application/gipp-rh/birthday/ports/birthday-flyer-renderer.port
 */

class BirthdayFlyerRendererPort {
    /**
     * @param {{ month: number, monthName: string,
     *   slides: { branchCode: string, branchName: string, page: number, pages: number,
     *             people: { name: string, sector: string, date: string }[] }[] }} flyer
     * @returns {Promise<Buffer>} arquivo `.pptx`.
     */
    render(flyer) { throw new Error('Not implemented'); }
}

module.exports = { BirthdayFlyerRendererPort };
