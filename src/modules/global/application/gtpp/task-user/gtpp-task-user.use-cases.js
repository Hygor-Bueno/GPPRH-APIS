/**
 * @fileoverview Casos de uso — Task User GTPP (vínculo de usuários colaboradores a tarefas).
 * @module modules/global/application/gtpp/task-user/gtpp-task-user.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { assertTaskEditable } = require('../../../domain/gtpp/task/task-editability.rules');
const { assertAnyOwnerOrAdmin } = require('../../../domain/gtpp/task/task-ownership.guard');

const EV_USER = 5; // usuário vinculado/desvinculado

class GtppTaskUserUseCases {
    /**
     * @param {{
     *   repository: import('./ports/task-user-repository.port').TaskUserRepositoryPort,
     *   taskGuardRepository: import('../ports/gtpp-task-guard-repository.port').GtppTaskGuardRepositoryPort,
     *   eventPublisher: import('../ports/gtpp-event-publisher.port').GtppEventPublisherPort,
     * }} deps
     */
    constructor({ repository, taskGuardRepository, eventPublisher }) {
        this.repository = repository;
        this.taskGuardRepository = taskGuardRepository;
        this.eventPublisher = eventPublisher;
    }

    async getTaskUsers(taskId) {
        return this.repository.findTaskUsers(taskId);
    }

    /**
     * Alterna o vínculo de um usuário à tarefa (add ↔ remove).
     * Somente o criador da tarefa ou um administrador pode gerenciar vínculos,
     * e a tarefa precisa estar em um estado editável.
     * @throws {AppError} 404/403/400
     */
    async toggleTaskUser(taskId, userId, currentUser) {
        const info = await this.taskGuardRepository.findStateAndCreator(taskId);
        if (!info) throw new AppError('Tarefa não encontrada.', 404);

        const permissions = Array.isArray(currentUser?.permissions) ? currentUser.permissions : [];
        assertAnyOwnerOrAdmin({ currentUserId: currentUser?.id, ownerIds: [info.creatorId], permissions });
        assertTaskEditable(info.stateId);

        const alreadyInTask = await this.repository.isUserInTask(taskId, userId);

        let action;
        if (!alreadyInTask) {
            await this.repository.addUser(taskId, userId);
            action = 'added';
        } else {
            await this.repository.removeUser(taskId, userId);
            action = 'removed';
        }

        // Quando removido, o usuário já não está em gt_task_user — por isso é
        // passado explicitamente em includeUserIds para garantir que ele
        // ainda receba o evento e possa remover a tarefa da sua tela.
        this.eventPublisher
            .broadcastEvent(taskId, currentUser.id, EV_USER, { action, id: userId }, action === 'removed' ? [userId] : [])
            .catch(() => {});

        return { action };
    }
}

module.exports = { GtppTaskUserUseCases };
