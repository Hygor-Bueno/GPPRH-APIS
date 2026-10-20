/**
 * @fileoverview Porta de geração do cartaz de aniversariantes.
 * @module modules/global/application/gipp-rh/birthday/ports/birthday-flyer-renderer.port
 */

class BirthdayFlyerRendererPort {
    /**
     * @param {{ month: number, monthName: string,
     *   slides: { branchCode: string, branchName: string, page: number, pages: number, artKey: string,
     *             people: { name: string, sector: string, date: string }[] }[],
     *   arts: Record<string, { buffer: Buffer, width: number, height: number, layout: object }> }} flyer
     *   `arts[slide.artKey]` é o fundo (PNG) e as medidas do slide — ver `birthday-flyer-art.rules`.
     * @returns {Promise<Buffer>} arquivo `.pptx`.
     */
    render(flyer) { throw new Error('Not implemented'); }
}

module.exports = { BirthdayFlyerRendererPort };
