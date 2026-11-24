/**
 * @fileoverview Casos de uso — conferência pelo identificador (GAPP).
 *
 * O auditor não escolhe o ativo: informa (ou lê no QR) o identificador, que em
 * `gapp_active_identifiers` aponta para um único ativo.
 * - `identify`: diz qual é o ativo e se ele faz parte da auditoria.
 * - `addUnexpected`: inclui na auditoria um ativo que não estava previsto; a
 *   partir daí ele é conferido como qualquer outro (e vira divergência UNEXPECTED).
 *
 * Mesmas regras de escopo do módulo: usuário do GAPP, ativos e auditoria do
 * grupo de trabalho dele; inclusão só com a auditoria aberta/em andamento,
 * dentro de `runLocked`.
 *
 * @module modules/global/application/gapp/active-audit/gapp-active-audit-identify.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { normalizeIdentifier } = require('../active-identifier/gapp-active-identifier.use-cases');
const {
    lockedStatusMessage, toSnapshotAsset, toUnexpectedAsset, appendUnexpectedAsset, MAX_ACTIVES_PER_AUDIT,
} = require('../../../domain/gapp/active-audit/active-audit.rules');

const findInAudit = (initialData, activeId) =>
    (initialData?.assets ?? []).find(asset => Number(asset.active_id) === Number(activeId)) ?? null;

class GappActiveAuditIdentifyUseCases {
    /**
     * @param {Object} deps
     * @param {import('./ports/active-audit-repository.port').ActiveAuditRepositoryPort} deps.repository
     * @param {import('../active-identifier/ports/active-identifier-repository.port').ActiveIdentifierRepositoryPort} deps.identifierRepository
     * @param {import('../ports/gapp-user-repository.port').GappUserRepositoryPort} deps.userRepository
     */
    constructor({ repository, identifierRepository, userRepository }) {
        this.repository = repository;
        this.identifierRepository = identifierRepository;
        this.userRepository = userRepository;
    }

    /** @private Usuário do GAPP e auditoria do grupo dele, ou 404. */
    async _scope(auditId, currentUser) {
        const gappUser = await this.userRepository.findAuthByAccessCode(currentUser?.id);
        if (!gappUser) throw new AppError('Usuário autenticado não está cadastrado no GAPP (access_code não localizado)', 404);
        const audit = await this.repository.findById(Number(auditId), gappUser.work_group_fk);
        if (!audit) throw new AppError('Auditoria não encontrada.', 404);
        return { gappUser, audit };
    }

    /** @private Linha de gapp_active do grupo do usuário, ou 404. */
    async _findActive(activeId, workGroupFk) {
        const [row] = await this.repository.findActivesForAudit({ scope: {}, workGroupFk, activeIds: [Number(activeId)], limit: 1 });
        if (!row) throw new AppError('O ativo deste identificador não pertence ao seu grupo de trabalho.', 404, { code: 'GAPP_AUDIT_ACTIVE_NOT_FOUND' });
        return row;
    }

    /**
     * Ativo do identificador e se ele está na auditoria.
     * @returns {Promise<{ in_audit: boolean, asset: object, identifier: { identifier_type: string, identifier_value: string } }>}
     */
    async identify(auditId, data, currentUser) {
        const { gappUser, audit } = await this._scope(auditId, currentUser);
        const { value, error } = normalizeIdentifier(data);
        if (error) throw new AppError(error, 400);

        const owner = await this.identifierRepository.findByValue(value.type, value.value);
        if (!owner) {
            throw new AppError('Identificador não cadastrado em nenhum ativo. Cadastre-o no formulário do ativo.', 404, { code: 'GAPP_AUDIT_IDENTIFIER_UNKNOWN' });
        }
        const planned = findInAudit(audit.initial_data, owner.active_id_fk);
        const asset = planned ?? toSnapshotAsset(await this._findActive(owner.active_id_fk, gappUser.work_group_fk));
        return { in_audit: Boolean(planned), asset, identifier: { identifier_type: value.type, identifier_value: value.value } };
    }

    /** Inclui o ativo como não previsto e devolve a fotografia gravada. */
    async addUnexpected(auditId, activeId, currentUser) {
        const { gappUser, audit } = await this._scope(auditId, currentUser);
        const row = await this._findActive(activeId, gappUser.work_group_fk);
        const asset = toUnexpectedAsset(row, currentUser.id); // _user.id de quem incluiu

        await this.repository.runLocked(audit.audit_id, async tx => {
            if (!tx.audit) throw new AppError('Auditoria não encontrada.', 404);
            const locked = lockedStatusMessage(tx.audit.status_audit);
            if (locked) throw new AppError(locked, 409, { code: 'GAPP_AUDIT_LOCKED' });
            if (findInAudit(tx.audit.initial_data, row.active_id)) throw new AppError('Este ativo já faz parte da auditoria.', 409, { code: 'GAPP_AUDIT_ACTIVE_ALREADY_IN' });
            const next = appendUnexpectedAsset(tx.audit.initial_data, asset);
            if (next.assets.length > MAX_ACTIVES_PER_AUDIT) throw new AppError(`Uma auditoria aceita no máximo ${MAX_ACTIVES_PER_AUDIT} ativos.`, 400);
            await tx.updateInitialData(next);
        });
        return asset;
    }
}

module.exports = { GappActiveAuditIdentifyUseCases };
