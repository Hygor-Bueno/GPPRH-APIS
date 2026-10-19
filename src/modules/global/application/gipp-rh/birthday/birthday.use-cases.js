/**
 * @fileoverview Aniversariantes do mês — lista, cartaz (.pptx) por filial e a
 * lista de exclusão de quem não sai no cartaz.
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
    normalizeExclusionInput,
    normalizeExclusionId,
    withoutExcluded,
    toExclusionEntry,
} = require('../../../domain/gipp-rh/birthday.rules');

class GippRhBirthdayUseCases {
    /**
     * @param {{ repository: import('./ports/birthday-repository.port').BirthdayRepositoryPort,
     *           exclusionRepository: import('./ports/birthday-exclusion-repository.port').BirthdayExclusionRepositoryPort,
     *           flyerRenderer: import('./ports/birthday-flyer-renderer.port').BirthdayFlyerRendererPort }} deps
     */
    constructor({ repository, exclusionRepository, flyerRenderer }) {
        this.repository = repository;
        this.exclusionRepository = exclusionRepository;
        this.flyerRenderer = flyerRenderer;
    }

    /**
     * Sem quem está na lista de exclusão. Protheus (SQL Server) e lista (MySQL)
     * são servidores diferentes: as duas leituras saem juntas e o filtro é aqui.
     *
     * @param {{ month: unknown, branches?: unknown }} query
     * @returns {Promise<{ month: number, month_name: string,
     *   branches: { branchCode: string, branchName: string, people: object[] }[] }>}
     */
    async listByMonth({ month, branches }) {
        const refMonth = normalizeMonth(month);
        const branchCodes = normalizeBranchCodes(branches);
        const [rows, excludedCpfs] = await Promise.all([
            this.repository.findByMonth(refMonth, branchCodes),
            this.exclusionRepository.listCpfs(),
        ]);
        return {
            month: refMonth,
            month_name: monthName(refMonth),
            branches: groupByBranch(withoutExcluded(rows, excludedCpfs).map(toBirthdayEntry)),
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

    /** @returns {Promise<ReturnType<typeof toExclusionEntry>[]>} */
    async listExclusions() {
        const exclusions = await this.exclusionRepository.list();
        const contracts = await this.repository.findCurrentContractsByCpf(exclusions.map(x => x.cpf));
        const byCpf = new Map(contracts.map(c => [String(c.cpf).trim(), c]));
        // Por filial e nome, como a lista do mês; quem não tem contrato vai para o fim.
        return exclusions
            .map(x => toExclusionEntry(x, byCpf.get(String(x.cpf).trim()) ?? null))
            .sort((a, b) => (a.branchCode ?? '￿').localeCompare(b.branchCode ?? '￿')
                || (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR'));
    }

    /**
     * Tira a pessoa do cartaz em todos os meses, pelo CPF do contrato informado.
     *
     * @param {{ branch_code?: unknown, registration?: unknown, reason?: unknown }} body
     * @param {number} userId - `req.user.id` (`_user.id`), nunca do body.
     * @returns {Promise<{ id: number }>}
     */
    async addExclusion(body, userId) {
        const { branchCode, registration, reason } = normalizeExclusionInput(body);
        const cpf = await this.repository.findEmployeeCpf(branchCode, registration);
        if (!cpf) {
            throw new AppError(`Matrícula ${registration} não encontrada na filial ${branchCode}.`, 404, {
                code: BirthdayErrorCode.EmployeeNotFound,
            });
        }
        const id = await this.exclusionRepository.add({ cpf, reason, createdBy: userId });
        return { id };
    }

    /** @param {unknown} rawId */
    async removeExclusion(rawId) {
        const id = normalizeExclusionId(rawId);
        const removed = await this.exclusionRepository.remove(id);
        if (!removed) {
            throw new AppError('Exclusão não encontrada.', 404, {
                code: BirthdayErrorCode.ExclusionNotFound,
            });
        }
    }
}

module.exports = { GippRhBirthdayUseCases };
