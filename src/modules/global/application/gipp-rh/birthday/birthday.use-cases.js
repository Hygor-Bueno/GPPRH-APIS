/**
 * @fileoverview Aniversariantes do mês — lista e cartaz (.pptx) por filial.
 * @module modules/global/application/gipp-rh/birthday/birthday.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const {
    BirthdayErrorCode,
    normalizeMonth,
    normalizeBranchCodes,
    monthName,
    toBirthdayEntry,
    groupByBranch,
    paginate,
} = require('../../../domain/gipp-rh/birthday.rules');

class GippRhBirthdayUseCases {
    /**
     * @param {{ repository: import('./ports/birthday-repository.port').BirthdayRepositoryPort,
     *           flyerRenderer: import('./ports/birthday-flyer-renderer.port').BirthdayFlyerRendererPort }} deps
     */
    constructor({ repository, flyerRenderer }) {
        this.repository = repository;
        this.flyerRenderer = flyerRenderer;
    }

    /**
     * @param {{ month: unknown, branches?: unknown }} query
     * @returns {Promise<{ month: number, month_name: string,
     *   branches: { branchCode: string, branchName: string, people: object[] }[] }>}
     */
    async listByMonth({ month, branches }) {
        const refMonth = normalizeMonth(month);
        const branchCodes = normalizeBranchCodes(branches);
        const rows = await this.repository.findByMonth(refMonth, branchCodes);
        return {
            month: refMonth,
            month_name: monthName(refMonth),
            branches: groupByBranch(rows.map(toBirthdayEntry)),
        };
    }

    /**
     * @param {{ month: unknown, branches?: unknown }} query
     * @returns {Promise<{ fileName: string, buffer: Buffer }>}
     */
    async buildFlyer(query) {
        const list = await this.listByMonth(query);
        if (!list.branches.length) {
            throw new AppError(`Nenhum aniversariante em ${list.month_name}.`, 404, {
                code: BirthdayErrorCode.NoBirthdays,
            });
        }
        const buffer = await this.flyerRenderer.render({
            month: list.month,
            monthName: list.month_name,
            slides: paginate(list.branches),
        });
        // Só ASCII: o nome vai cru no Content-Disposition ("março" quebraria o header).
        const asciiMonth = list.month_name.normalize('NFD').replace(/[̀-ͯ]/g, '');
        const fileName = `aniversariantes-${String(list.month).padStart(2, '0')}-${asciiMonth}.pptx`;
        return { fileName, buffer };
    }
}

module.exports = { GippRhBirthdayUseCases };
