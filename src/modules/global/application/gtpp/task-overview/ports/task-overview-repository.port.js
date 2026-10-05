/**
 * @fileoverview Porta (contrato) de persistência — sub-feature Task Overview (GTPP).
 * @module modules/global/application/gtpp/task-overview/ports/task-overview-repository.port
 */

class TaskOverviewRepositoryPort {
    /**
     * Lista tarefas de QUALQUER usuário conforme os filtros, sem a trava de
     * criador/vinculado.
     * @param {object} filters - saída de `normalizeOverviewFilters`
     * @returns {Promise<{data: object[], hasMore: boolean}>}
     */
    findTasks(filters) { throw new Error('Not implemented'); }

    /**
     * Total de tarefas por estado com os mesmos filtros (paginação ignorada).
     * @param {object} filters
     * @returns {Promise<Array<{state_id:number, state_description:string, state_color:string, total:number}>>}
     */
    countByState(filters) { throw new Error('Not implemented'); }

    /**
     * Usuários do sistema ligados a um colaborador do Protheus.
     * @param {{registration: string, branchCode: string}} employee
     * @returns {Promise<number[]>} vazio se o colaborador não tem usuário
     */
    findUserIdsByEmployee(employee) { throw new Error('Not implemented'); }
}

module.exports = { TaskOverviewRepositoryPort };
