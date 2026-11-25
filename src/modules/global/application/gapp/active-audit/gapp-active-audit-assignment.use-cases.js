/**
 * @fileoverview Casos de uso — responsáveis pela execução da auditoria (GAPP).
 *
 * Mesma ideia do vínculo de usuários às tarefas do GTPP: quem abriu escolhe
 * (na abertura ou depois, enquanto aberta/em andamento) usuários ativos do
 * mesmo grupo de trabalho, que passam a poder conferir. Mudar a lista é só
 * de quem abriu; ela é gravada inteira (quem saiu sai, quem entrou entra).
 *
 * @module modules/global/application/gapp/active-audit/gapp-active-audit-assignment.use-cases
 */

'use strict';

const { AppError } = require('../../../../../errors/app.error');
const {
    ACCESS_ERROR, isRequester, notRequesterMessage, normalizeAssignees,
} = require('../../../domain/gapp/active-audit/audit-access.rules');

class GappActiveAuditAssignmentUseCases {
    /**
     * @param {Object} deps
     * @param {import('./gapp-active-audit.use-cases').GappActiveAuditUseCases} deps.auditUseCases
     * @param {import('./ports/active-audit-repository.port').ActiveAuditRepositoryPort} deps.repository
     * @param {import('../ports/gapp-user-repository.port').GappUserRepositoryPort} deps.userRepository
     */
    constructor({ auditUseCases, repository, userRepository }) {
        this.auditUseCases = auditUseCases;
        this.repository = repository;
        this.userRepository = userRepository;
    }

    /** @private Usuário do GAPP (grupo de trabalho), ou 404. */
    async _gappUser(currentUser) {
        const gappUser = await this.userRepository.findAuthByAccessCode(currentUser?.id);
        if (!gappUser) throw new AppError('Usuário autenticado não está cadastrado no GAPP (access_code não localizado)', 404);
        return gappUser;
    }

    /** Quem pode ser responsável: usuários ativos do grupo de trabalho de quem pede. */
    async listAssignableUsers(currentUser) {
        const gappUser = await this._gappUser(currentUser);
        return this.repository.listAssignableUsers(gappUser.work_group_fk);
    }

    /**
     * Grava a lista de responsáveis (vazia tira todos). Quem abriu é ignorado
     * na lista: já confere por ser o solicitante.
     * @param {{ user_assigned_ids?: number[] }} data
     * @throws {AppError} 403 quem não abriu · 409 encerrada · 400 lista inválida ou usuário fora do grupo
     */
    async setAssignees(auditId, data, currentUser) {
        const gappUser = await this._gappUser(currentUser);
        const audit = await this.repository.findById(Number(auditId), gappUser.work_group_fk);
        if (!audit) throw new AppError('Auditoria não encontrada.', 404);
        if (!isRequester(audit, currentUser.id)) {
            throw new AppError(notRequesterMessage('mudar os responsáveis'), 403, { code: ACCESS_ERROR.NOT_REQUESTER });
        }
        const { value, error } = normalizeAssignees(data?.user_assigned_ids ?? [], audit.user_open_id_fk);
        if (error) throw new AppError(error, 400);
        await this.auditUseCases.assertAssignable(value, gappUser);
        await this.repository.runLocked(audit.audit_id, async tx => {
            if (!tx.audit) throw new AppError('Auditoria não encontrada.', 404);
            this.auditUseCases._assertEditable(tx.audit.status_audit);
            await tx.saveAssignees(value);
        });
        return this.auditUseCases.getAuditById(audit.audit_id, currentUser);
    }
}

module.exports = { GappActiveAuditAssignmentUseCases };
