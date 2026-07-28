/**
 * @fileoverview Casos de uso — Task Scope GTPP.
 *
 * Sem `eventPublisher`: escopo nunca emite evento WebSocket.
 * O enriquecimento com descrições do Protheus (empresa/loja/CC) permanece
 * no controller, que é quem já orquestra a chamada a `protheusService`.
 *
 * @module modules/global/application/gtpp/task-scope/gtpp-task-scope.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { assertTaskEditable } = require('../../../domain/gtpp/task/task-editability.rules');

class GtppTaskScopeUseCases {
    /**
     * @param {{
     *   repository: import('./ports/task-scope-repository.port').TaskScopeRepositoryPort,
     *   taskGuardRepository: import('../ports/gtpp-task-guard-repository.port').GtppTaskGuardRepositoryPort,
     * }} deps
     */
    constructor({ repository, taskGuardRepository }) {
        this.repository = repository;
        this.taskGuardRepository = taskGuardRepository;
    }

    /** @private @throws {AppError} 404/400 */
    async _assertEditable(taskId) {
        const info = await this.taskGuardRepository.findStateAndCreator(taskId);
        if (!info) throw new AppError('Tarefa não encontrada.', 404);
        assertTaskEditable(info.stateId);
    }

    async getTaskScope(taskId) {
        return this.repository.findByTask(taskId);
    }

    /**
     * Adiciona um escopo à tarefa. Níveis NULL significam "todos" naquele nível.
     * Ex.: { company_code: '01', branch_code: '0101' } → toda a loja 0101.
     */
    async addTaskScope(taskId, { company_code, branch_code, cost_center_code }) {
        await this._assertEditable(taskId);
        return this.repository.insert(taskId, {
            company_code:     company_code     ?? null,
            branch_code:      branch_code      ?? null,
            cost_center_code: cost_center_code ?? null,
        });
    }

    /** @throws {AppError} 404 se o escopo não existir */
    async removeTaskScope(taskId, scopeId) {
        await this._assertEditable(taskId);
        const { affectedRows } = await this.repository.remove(taskId, scopeId);
        if (affectedRows === 0) throw new AppError('Escopo não encontrado.', 404);
    }
}

module.exports = { GtppTaskScopeUseCases };
