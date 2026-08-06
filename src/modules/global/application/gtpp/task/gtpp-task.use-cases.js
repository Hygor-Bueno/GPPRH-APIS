/**
 * @fileoverview Casos de uso — Task GTPP (núcleo: máquina de estados manual + CRUD).
 * @module modules/global/application/gtpp/task/gtpp-task.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const {
    assertStructurallyAllowed, needsItemCountCheck, assertItemCountAllows,
} = require('../../../domain/gtpp/task/task-state-transition.rules');
const { assertTaskEditable } = require('../../../domain/gtpp/task/task-editability.rules');
const { assertAnyOwnerOrAdmin } = require('../../../domain/gtpp/task/task-ownership.guard');

// ─── Tipos de evento GTPP ─────────────────────────────────────────────────────
const EV_DESCRIPTION = 3;  // descrição da tarefa atualizada
const EV_STATE       = 6;  // estado da tarefa alterado
const EV_GENERAL      = 8; // atualização geral (título, tema, exclusão etc.)

class GtppTaskUseCases {
    /**
     * @param {{
     *   repository: import('./ports/task-repository.port').TaskRepositoryPort,
     *   taskGuardRepository: import('../ports/gtpp-task-guard-repository.port').GtppTaskGuardRepositoryPort,
     *   eventPublisher: import('../ports/gtpp-event-publisher.port').GtppEventPublisherPort,
     * }} deps
     */
    constructor({ repository, taskGuardRepository, eventPublisher }) {
        this.repository = repository;
        this.taskGuardRepository = taskGuardRepository;
        this.eventPublisher = eventPublisher;
    }

    /** @private @throws {AppError} 404/403 */
    async _assertOwnerOrAdmin(taskId, currentUser) {
        const info = await this.taskGuardRepository.findStateAndCreator(taskId);
        if (!info) throw new AppError('Tarefa não encontrada.', 404);
        const permissions = Array.isArray(currentUser?.permissions) ? currentUser.permissions : [];
        assertAnyOwnerOrAdmin({ currentUserId: currentUser?.id, ownerIds: [info.creatorId], permissions });
        return info;
    }

    async getTaskStates() {
        return this.repository.findTaskStates();
    }

    async getTaskHistoric(taskId) {
        return this.repository.findHistoric(taskId);
    }

    async getTasksMobile(userId, { stateId = null, page = 1, limit = 50 } = {}) {
        const offset = (page - 1) * limit;
        const { data, hasMore } = await this.repository.findTasksForUser(userId, { stateId, limit, offset });
        return { data, page, limit, hasMore };
    }

    /**
     * @param {number[]} stateIds - máx. 10, checado no controller
     *
     * Uma única ida ao banco pra todos os estados (não é mais 1 conexão do
     * pool por state_id) — sob rajada de vários usuários abrindo o board ao
     * mesmo tempo, isso saturava o poolGlobal só com esse endpoint.
     */
    async getTasksBoard(userId, { stateIds, page = 1, limit = 20 }) {
        const offset = (page - 1) * limit;
        const rows = await this.repository.findTasksForUserByStates(userId, { stateIds, limit, offset });

        const board = {};
        for (const stateId of stateIds) {
            board[stateId] = { data: [], page, limit, hasMore: false };
        }
        for (const row of rows) {
            board[row.state_id]?.data.push(row);
        }
        for (const stateId of stateIds) {
            board[stateId].hasMore = board[stateId].data.length === limit;
        }
        return board;
    }

    /** @throws {AppError} 404 */
    async getTaskById(taskId) {
        const task = await this.repository.findTaskDetail(taskId);
        if (!task) throw new AppError('Tarefa não encontrada.', 404);
        return task;
    }

    /** @throws {AppError} 400 se título ausente */
    async createTask(userId, { description, fullDescription, priority, initialDate, finalDate, themeId }) {
        if (!description || !description.trim()) throw new AppError('O título é obrigatório.', 400);

        return this.repository.createTask(userId, {
            description: description.trim(),
            fullDescription: fullDescription?.trim() ?? null,
            priority: priority ?? null,
            initialDate: initialDate ?? null,
            finalDate: finalDate ?? null,
            themeId: themeId ?? null,
        });
    }

    /**
     * Atualiza o estado de uma tarefa (transição manual).
     * A regra de exclusividade de admin para o estado 5 (Expirado) é
     * autorização de rota específica e permanece no controller.
     */
    async updateTaskState(taskId, newStateId, description, currentUser, days) {
        const { stateId: currentStateId } = await this._assertOwnerOrAdmin(taskId, currentUser);

        assertStructurallyAllowed(newStateId, currentStateId);
        if (needsItemCountCheck(newStateId)) {
            const stats = await this.taskGuardRepository.findItemStats(taskId);
            assertItemCountAllows(newStateId, stats);
        }

        await this.repository.updateStateDirect(taskId, newStateId);
        if (days && Number(days) > 0) {
            await this.repository.extendFinalDate(taskId, Number(days));
        }
        await this.repository.insertHistoric(taskId, newStateId, description?.trim() || 'Estado atualizado manualmente');

        this.eventPublisher
            .broadcastEvent(taskId, currentUser.id, EV_STATE, { action: 'updated', state_id: newStateId, auto: false })
            .catch(() => {});
    }

    /** @throws {AppError} 400 título vazio / 404 tarefa não encontrada */
    async updateTaskTitle(taskId, title, currentUser) {
        if (!title || !title.trim()) throw new AppError('O título não pode ser vazio.', 400);

        const { stateId } = await this._assertOwnerOrAdmin(taskId, currentUser);
        assertTaskEditable(stateId);

        const { affectedRows } = await this.repository.updateTitle(taskId, title.trim());
        if (affectedRows === 0) throw new AppError('Tarefa não encontrada.', 404);

        this.eventPublisher
            .broadcastEvent(taskId, currentUser.id, EV_GENERAL, { action: 'updated', description: title })
            .catch(() => {});
    }

    /** @throws {AppError} 404 */
    async updateTaskDescription(taskId, fullDescription, currentUser) {
        const { stateId } = await this._assertOwnerOrAdmin(taskId, currentUser);
        assertTaskEditable(stateId);

        const { affectedRows } = await this.repository.updateDescription(taskId, fullDescription ?? null);
        if (affectedRows === 0) throw new AppError('Tarefa não encontrada.', 404);

        this.eventPublisher
            .broadcastEvent(taskId, currentUser.id, EV_DESCRIPTION, { action: 'updated', full_description: fullDescription ?? null })
            .catch(() => {});
    }

    /** @throws {AppError} 404 se o vínculo usuário/tarefa não existir */
    async updateTaskTheme(taskId, themeId, currentUser) {
        const { stateId } = await this._assertOwnerOrAdmin(taskId, currentUser);
        assertTaskEditable(stateId);

        const { affectedRows } = await this.repository.updateTheme(taskId, themeId ?? null, currentUser.id);
        if (affectedRows === 0) throw new AppError('Vínculo usuário/tarefa não encontrado.', 404);

        this.eventPublisher
            .broadcastEvent(taskId, currentUser.id, EV_GENERAL, { action: 'updated', theme_id: themeId ?? null })
            .catch(() => {});
    }

    /**
     * Remove permanentemente uma tarefa.
     * O evento é emitido ANTES da exclusão (depois não há mais participantes
     * para notificar) e é aguardado — se a notificação falhar, a exclusão não ocorre.
     * @throws {AppError} 404
     */
    async deleteTask(taskId, currentUser) {
        await this._assertOwnerOrAdmin(taskId, currentUser);

        await this.eventPublisher.broadcastEvent(taskId, currentUser.id, EV_GENERAL, { action: 'deleted' });

        const { affectedRows } = await this.repository.deleteTask(taskId);
        if (affectedRows === 0) throw new AppError('Tarefa não encontrada.', 404);
    }
}

module.exports = { GtppTaskUseCases };
