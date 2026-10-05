/**
 * @fileoverview Casos de uso — Task Overview GTPP (visão de supervisão / diretoria).
 *
 * Somente leitura: remove a trava "só vejo minhas tarefas" para quem tem
 * permissão de administração do GTPP. A checagem de permissão é feita na rota
 * (`canAny(['GTPP_MANAGE'])`, com bypass de SYSTEM_OWNER no middleware).
 *
 * Empresa/unidade/CC filtram pela lotação atual do CRIADOR da tarefa. Empresa e
 * unidade saem de `_user.branch_code` (MySQL); o centro de custo só existe no
 * Protheus, então é resolvido antes em pares matrícula + filial.
 *
 * @module modules/global/application/gtpp/task-overview/gtpp-task-overview.use-cases
 */

const { normalizeOverviewFilters } = require('../../../domain/gtpp/task-overview/task-overview-filter.rules');

class GtppTaskOverviewUseCases {
    /**
     * @param {{
     *   repository: import('./ports/task-overview-repository.port').TaskOverviewRepositoryPort,
     *   costCenterMemberRepository: import('./ports/cost-center-member-repository.port').CostCenterMemberRepositoryPort,
     * }} deps
     */
    constructor({ repository, costCenterMemberRepository }) {
        this.repository = repository;
        this.costCenterMemberRepository = costCenterMemberRepository;
    }

    /**
     * Normaliza a query e resolve o que depende de I/O: os usuários do
     * colaborador (matrícula + filial) e os colaboradores do CC.
     * @private
     * @returns {Promise<object|null>} filtros, ou null quando algum filtro já
     *   garante resultado vazio (colaborador sem usuário, CC sem ninguém)
     */
    async _resolveFilters(query) {
        const filters = normalizeOverviewFilters(query);

        let userIds = filters.userId != null ? [filters.userId] : [];
        if (filters.employeeRegistration) {
            userIds = await this.repository.findUserIdsByEmployee({
                registration: filters.employeeRegistration,
                branchCode:   filters.employeeBranch,
            });
            if (userIds.length === 0) return null;
        }

        let creatorPairs;
        if (filters.costCenterCode) {
            creatorPairs = await this.costCenterMemberRepository.findMembers({
                companyCode:    filters.companyCode,
                costCenterCode: filters.costCenterCode,
                branchCode:     filters.branchCode,
            });
            if (creatorPairs.length === 0) return null;
        }

        return { ...filters, userIds, creatorPairs };
    }

    /**
     * @param {object} query - `req.query` cru
     * @returns {Promise<{data: object[], page: number, limit: number, hasMore: boolean}>}
     * @throws {AppError} 400 para filtros inválidos
     */
    async listTasks(query) {
        const filters = await this._resolveFilters(query);
        if (!filters) {
            const { page, limit } = normalizeOverviewFilters(query);
            return { data: [], page, limit, hasMore: false };
        }

        const { data, hasMore } = await this.repository.findTasks(filters);
        return { data, page: filters.page, limit: filters.limit, hasMore };
    }

    /**
     * @param {object} query - `req.query` cru (page/limit são ignorados)
     * @returns {Promise<{total: number, states: object[]}>}
     * @throws {AppError} 400 para filtros inválidos
     */
    async summarizeTasks(query) {
        const filters = await this._resolveFilters(query);
        if (!filters) return { total: 0, states: [] };

        const states = await this.repository.countByState(filters);
        const total = states.reduce((sum, s) => sum + s.total, 0);
        return { total, states };
    }
}

module.exports = { GtppTaskOverviewUseCases };
