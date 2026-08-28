/**
 * @fileoverview Casos de uso — Task Item GTPP (itens de tarefa + motor de auto-transição).
 * @module modules/global/application/gtpp/task-item/gtpp-task-item.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { parseDate, validateItemDates } = require('../../../domain/gtpp/task-item/item-dates.validator');
const { computeAutoTransition } = require('../../../domain/gtpp/task/task-auto-transition.rules');
const { assertTaskEditable } = require('../../../domain/gtpp/task/task-editability.rules');
const { assertAnyOwnerOrAdmin } = require('../../../domain/gtpp/task/task-ownership.guard');

const EV_ITEM  = 2; // item alterado (check, criação, remoção, etc.)
const EV_STATE = 6; // estado da tarefa alterado (disparado pelo motor de auto-transição)

class GtppTaskItemUseCases {
    /**
     * @param {{
     *   repository: import('./ports/task-item-repository.port').TaskItemRepositoryPort,
     *   taskGuardRepository: import('../ports/gtpp-task-guard-repository.port').GtppTaskGuardRepositoryPort,
     *   eventPublisher: import('../ports/gtpp-event-publisher.port').GtppEventPublisherPort,
     * }} deps
     */
    constructor({ repository, taskGuardRepository, eventPublisher }) {
        this.repository = repository;
        this.taskGuardRepository = taskGuardRepository;
        this.eventPublisher = eventPublisher;
    }

    /** @private */
    _broadcastItemEvent(taskId, userId, extra) {
        this.eventPublisher.broadcastEvent(taskId, userId, EV_ITEM, extra).catch(() => {});
    }

    /**
     * Gerencia as transições automáticas de estado baseadas no progresso dos itens
     * (mapa completo em `task-auto-transition.rules`). Chamada após qualquer
     * check/uncheck/criação/remoção de item. Nunca deixa uma falha aqui derrubar
     * a operação principal do item — apenas registra e segue.
     * @private
     */
    async _autoToggleAnalyzing(taskId, userId) {
        try {
            const info = await this.taskGuardRepository.findStateAndCreator(taskId);
            const stateId = info?.stateId ?? null;
            if (![1, 2, 3].includes(stateId)) return;

            const stats = await this.taskGuardRepository.findItemStats(taskId);
            const transition = computeAutoTransition(stateId, stats);
            if (!transition) return;

            await this.taskGuardRepository.applyStateTransition(taskId, transition.newStateId, transition.historyDescription);
            this.eventPublisher
                .broadcastEvent(taskId, userId, EV_STATE, { action: 'updated', state_id: transition.newStateId, auto: true })
                .catch(() => {});
        } catch (err) {
            console.error('[gtpp:autoToggleAnalyzing] Failed to auto-toggle state:', err.message);
        }
    }

    /** @private @throws {AppError} 404 tarefa inexistente / 400 estado bloqueado */
    async _assertEditable(taskId) {
        const info = await this.taskGuardRepository.findStateAndCreator(taskId);
        if (!info) throw new AppError('Tarefa não encontrada.', 404);
        assertTaskEditable(info.stateId);
        return info;
    }

    /** @private @throws {AppError} 404/400/403 */
    async _assertEditableAndItemOrTaskOwnerOrAdmin(taskId, itemId, currentUser) {
        const guardInfo = await this._assertEditable(taskId);

        const item = await this.repository.findItemById(taskId, itemId);
        if (!item) throw new AppError('Item não encontrado.', 404);

        const ownerIds = [item.created_by, guardInfo.creatorId].filter(id => id != null);
        const permissions = Array.isArray(currentUser?.permissions) ? currentUser.permissions : [];
        assertAnyOwnerOrAdmin({ currentUserId: currentUser?.id, ownerIds, permissions });

        return item;
    }

    async getTaskItems(taskId) {
        return this.repository.findByTask(taskId);
    }

    /**
     * Cria um item na tarefa. Aceita arquivo e nota opcionais.
     * @throws {AppError} 400 descrição ausente / datas inválidas / tarefa bloqueada
     */
    async createTaskItem(taskId, userId, { description, file, note, yesNo, initialDate, finalDate }) {
        await this._assertEditable(taskId);

        if (!description || !description.trim()) throw new AppError('A descrição é obrigatória.', 400);

        // yes_no: -1 = questão ativa (padrão), 0 = item comum, 1 = sim, 2 = não
        const yesNoValue = yesNo !== undefined ? Number(yesNo) : -1;

        const parsedInitial = initialDate ? parseDate(initialDate, 'initial_date') : null;
        const parsedFinal   = finalDate   ? parseDate(finalDate,   'final_date')   : null;
        if (parsedInitial || parsedFinal) {
            const taskDates = await this.repository.findTaskDates(taskId);
            validateItemDates(parsedInitial, parsedFinal, taskDates ?? {});
        }

        const maxOrder = await this.repository.findMaxOrder(taskId);
        const { itemId } = await this.repository.insertItem(taskId, {
            description: description.trim(),
            order: maxOrder + 1,
            yesNo: yesNoValue,
            createdBy: userId,
            initialDate: parsedInitial,
            finalDate: parsedFinal,
        });

        if (file) await this.repository.attachFile(taskId, itemId, userId, file);
        if (note) await this.repository.updateNote(taskId, itemId, note);

        // Se a tarefa estava em "Validar" (3), o novo item desmarcado reverte para "Fazendo" (2)
        await this._autoToggleAnalyzing(taskId, userId);

        this._broadcastItemEvent(taskId, userId, { action: 'created', id: itemId });

        return { itemId };
    }

    /** @throws {AppError} 404/400 */
    async updateItemCheck(taskId, itemId, checkValue, userId) {
        await this._assertEditable(taskId);
        const value = checkValue ? 1 : 0;
        const { affectedRows } = await this.repository.updateCheck(taskId, itemId, value);
        if (affectedRows === 0) throw new AppError('Item não encontrado.', 404);
        await this._autoToggleAnalyzing(taskId, userId);
        this._broadcastItemEvent(taskId, userId, { action: 'check', id: itemId, check: value });
    }

    /** @throws {AppError} 404/400 */
    async updateItemYesNo(taskId, itemId, yesNo, userId) {
        await this._assertEditable(taskId);
        const { affectedRows } = await this.repository.updateYesNo(taskId, itemId, yesNo);
        if (affectedRows === 0) throw new AppError('Item não encontrado.', 404);
        await this._autoToggleAnalyzing(taskId, userId);
        this._broadcastItemEvent(taskId, userId, { action: 'yes_no', id: itemId, yes_no: yesNo });
    }

    /** @throws {AppError} 400/404 */
    async updateItemDescription(taskId, itemId, description, userId) {
        await this._assertEditable(taskId);
        if (!description || !description.trim()) throw new AppError('A descrição é obrigatória.', 400);
        const { affectedRows } = await this.repository.updateDescription(taskId, itemId, description.trim());
        if (affectedRows === 0) throw new AppError('Item não encontrado.', 404);
        this._broadcastItemEvent(taskId, userId, { action: 'description', id: itemId, description });
    }

    /** @throws {AppError} 404/400 */
    async updateItemFile(taskId, itemId, userId, file) {
        await this._assertEditable(taskId);
        const { affectedRows } = file
            ? await this.repository.attachFile(taskId, itemId, userId, file)
            : await this.repository.clearFile(taskId, itemId);
        if (affectedRows === 0) throw new AppError('Item não encontrado.', 404);
        this._broadcastItemEvent(taskId, userId, { action: 'file', id: itemId });
    }

    async getItemFileInfo(itemId) {
        return this.repository.findItemFileInfo(itemId);
    }

    /** @throws {AppError} 404 */
    async getItemFileId(taskId, itemId) {
        const fileId = await this.repository.findItemFileId(taskId, itemId);
        if (!fileId) throw new AppError('Arquivo não encontrado.', 404);
        return fileId;
    }

    async getItemFileBlob(taskId, itemId) {
        return this.repository.findItemFileBlob(taskId, itemId);
    }

    /** @throws {AppError} 404/400 */
    async updateItemNote(taskId, itemId, note, userId) {
        await this._assertEditable(taskId);
        const { affectedRows } = await this.repository.updateNote(taskId, itemId, note ?? null);
        if (affectedRows === 0) throw new AppError('Item não encontrado.', 404);
        this._broadcastItemEvent(taskId, userId, { action: 'note', id: itemId, note: note ?? null });
    }

    /** @throws {AppError} 404/400 */
    async updateItemAssignedTo(taskId, itemId, assignedTo, userId) {
        await this._assertEditable(taskId);
        const { affectedRows } = await this.repository.updateAssignedTo(taskId, itemId, assignedTo ?? null);
        if (affectedRows === 0) throw new AppError('Item não encontrado.', 404);
        this._broadcastItemEvent(taskId, userId, { action: 'assigned_to', id: itemId, assigned_to: assignedTo ?? null });
    }

    /** @throws {AppError} 404/400 */
    async updateItemStatus(taskId, itemId, status, userId) {
        await this._assertEditable(taskId);
        const { affectedRows } = await this.repository.updateStatus(taskId, itemId, status);
        if (affectedRows === 0) throw new AppError('Item não encontrado.', 404);
        this._broadcastItemEvent(taskId, userId, { action: 'status', id: itemId, status });
    }

    /** @throws {AppError} 404 item inexistente / 400 direção inválida ou tarefa bloqueada */
    async updateItemPosition(taskId, itemId, direction, userId) {
        await this._assertEditable(taskId);

        const item = await this.repository.findItemById(taskId, itemId);
        if (!item) throw new AppError('Item não encontrado.', 404);

        const adjacent = await this.repository.findAdjacentItem(taskId, item.order, direction);
        if (!adjacent) throw new AppError('Não é possível mover o item nesta direção.', 400);

        await this.repository.updateOrder(itemId, adjacent.order);
        await this.repository.updateOrder(adjacent.id, item.order);

        // O evento usa 'updated' (não 'position') — mantém o mesmo rótulo genérico do controller original
        this._broadcastItemEvent(taskId, userId, { action: 'updated', id: itemId, direction });
    }

    /**
     * Atualiza as datas de prazo de um item. Restrito ao dono do item, ao
     * criador da tarefa ou a um administrador, e exige que a tarefa esteja
     * em um estado editável.
     * @throws {AppError} 403/404/400
     */
    async updateItemDates(taskId, itemId, initialDate, finalDate, currentUser) {
        await this._assertEditableAndItemOrTaskOwnerOrAdmin(taskId, itemId, currentUser);

        const parsedInitial = initialDate ? parseDate(initialDate, 'initial_date') : null;
        const parsedFinal   = finalDate   ? parseDate(finalDate,   'final_date')   : null;
        if (parsedInitial || parsedFinal) {
            const taskDates = await this.repository.findTaskDates(taskId);
            validateItemDates(parsedInitial, parsedFinal, taskDates ?? {});
        }

        const { affectedRows } = await this.repository.updateDates(taskId, itemId, parsedInitial, parsedFinal);
        if (affectedRows === 0) throw new AppError('Item não encontrado.', 404);

        this._broadcastItemEvent(taskId, currentUser.id, {
            action: 'dates', id: itemId, initial_date: initialDate, final_date: finalDate,
        });
    }

    /** @throws {AppError} 404/400 */
    async deleteTaskItem(taskId, itemId, userId) {
        await this._assertEditable(taskId);
        const { affectedRows } = await this.repository.softDelete(taskId, itemId);
        if (affectedRows === 0) throw new AppError('Item não encontrado.', 404);
        await this._autoToggleAnalyzing(taskId, userId);
        this._broadcastItemEvent(taskId, userId, { action: 'deleted', id: itemId });
    }
}

module.exports = { GtppTaskItemUseCases };
