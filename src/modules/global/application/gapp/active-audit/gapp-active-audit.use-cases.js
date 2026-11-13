/**
 * @fileoverview Casos de uso — Auditoria de Ativos / Inventário (GAPP).
 *
 * - Usuários (`user_open_id_fk`, `user_register_id_fk`, `user_finish_id_fk`)
 *   são sempre o `gapp_user.user_id` do usuário autenticado — nunca do body.
 * - Escopo: só ativos e auditorias do `work_group_fk` do usuário.
 * - O cadastro original (`gapp_active`) nunca é alterado pela auditoria.
 * - Depois da abertura, toda escrita roda em `repository.runLocked`
 *   (transação + `FOR UPDATE` na auditoria): o status é conferido e alterado
 *   na mesma transação, sem corrida com finalização/cancelamento.
 *
 * @module modules/global/application/gapp/active-audit/gapp-active-audit.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const {
    AUDIT_STATUS, AUDIT_STATUS_LABEL,
    lockedStatusMessage, normalizeActiveIds, toSnapshotAsset,
    normalizeRegistration, findDuplicateIdentifiers,
    buildReview, buildFinalData, buildCanceledData,
} = require('../../../domain/gapp/active-audit/active-audit.rules');

/** Pares (tipo, valor) dos itens com identificador — para buscar conflitos no histórico. */
const identifierPairs = items => items
    .filter(item => item.identifier_value != null && String(item.identifier_value).trim() !== '')
    .map(item => [item.identifier_type, String(item.identifier_value).trim()]);

/** Campos que a edição pode trocar; o que não vier mantém o valor atual (inclusive a transferência). */
const EDITABLE_ITEM_FIELDS = [
    'identifier_type', 'identifier_value', 'asset_condition', 'additional_items', 'observations',
    'is_transfer', 'transfer_reason', 'transfer_branch_code', 'transfer_costcenter_code', 'transfer_responsible_registration',
];
const mergeItem = (current, data) =>
    Object.fromEntries(EDITABLE_ITEM_FIELDS.map(field => [field, data[field] !== undefined ? data[field] : current[field]]));

const withStatusLabel = audit => audit && ({ ...audit, status_label: AUDIT_STATUS_LABEL[audit.status_audit] ?? null });

class GappActiveAuditUseCases {
    /**
     * @param {Object} deps
     * @param {import('./ports/active-audit-repository.port').ActiveAuditRepositoryPort} deps.repository
     * @param {import('../ports/gapp-user-repository.port').GappUserRepositoryPort} deps.userRepository
     */
    constructor({ repository, userRepository }) {
        this.repository = repository;
        this.userRepository = userRepository;
    }

    /** @private @throws {AppError} 404 se o usuário autenticado não estiver no GAPP. */
    async _resolveGappUser(currentUser) {
        const gappUser = await this.userRepository.findAuthByAccessCode(currentUser?.id);
        if (!gappUser) {
            throw new AppError('Usuário autenticado não está cadastrado no GAPP (access_code não localizado)', 404);
        }
        return gappUser;
    }

    /** @private Auditoria do grupo do usuário, ou 404. */
    async _getScopedAudit(auditId, gappUser) {
        const audit = await this.repository.findById(Number(auditId), gappUser.work_group_fk);
        if (!audit) throw new AppError('Auditoria não encontrada.', 404);
        return audit;
    }

    /** @private */
    _assertEditable(status) {
        const message = lockedStatusMessage(status);
        if (message) throw new AppError(message, 409, { code: 'GAPP_AUDIT_LOCKED' });
    }

    // ─── Etapa 1 — Abertura ─────────────────────────────────────────

    /**
     * Abre a auditoria com a fotografia dos ativos selecionados.
     * @param {{ active_ids: number[] }} data
     */
    async openAudit(data, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);

        const { ids, error } = normalizeActiveIds(data?.active_ids);
        if (error) throw new AppError(error, 400);

        const rows = await this.repository.findActivesForSnapshot(ids, gappUser.work_group_fk);
        const found = new Set(rows.map(row => Number(row.active_id)));
        const missing = ids.filter(id => !found.has(id));
        if (missing.length) {
            throw new AppError(`Ativo(s) não encontrado(s): ${missing.join(', ')}.`, 404, {
                code: 'GAPP_AUDIT_ACTIVE_NOT_FOUND',
                details: { active_ids: missing },
            });
        }

        const initialData = { assets: rows.map(toSnapshotAsset) };
        const { insertId } = await this.repository.createAudit({
            user_open_id_fk: gappUser.user_id,
            initial_data: initialData,
            quantity_active: initialData.assets.length,
        });

        return this.getAuditById(insertId, currentUser);
    }

    // ─── Consulta / histórico ───────────────────────────────────────

    /** `work_group_fk` nunca vem da query — é o grupo do usuário autenticado. */
    async listAudits(filters, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        const result = await this.repository.list({ ...filters, work_group_fk: gappUser.work_group_fk });
        return { ...result, items: result.items.map(withStatusLabel) };
    }

    /** Cabeçalho + initial_data + final_data + conferências registradas. */
    async getAuditById(auditId, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        const audit = await this._getScopedAudit(auditId, gappUser);
        const items = await this.repository.listItems(audit.audit_id);
        return { ...withStatusLabel(audit), items };
    }

    // ─── Etapa 3 — Revisão ──────────────────────────────────────────

    /** Previstos, conferidos, pendentes, divergências e resumo de conservação. */
    async getReview(auditId, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        const audit = await this._getScopedAudit(auditId, gappUser);

        // Finalizada/cancelada: a revisão é o que foi consolidado no fechamento.
        if (audit.status_audit === AUDIT_STATUS.FINISHED || audit.status_audit === AUDIT_STATUS.CANCELED) {
            return { audit_id: audit.audit_id, status_audit: audit.status_audit, status_label: AUDIT_STATUS_LABEL[audit.status_audit], ...audit.final_data };
        }

        const items = await this.repository.listItems(audit.audit_id);
        const history = await this.repository.findIdentifierHistory(audit.audit_id, identifierPairs(items));
        return {
            audit_id: audit.audit_id,
            status_audit: audit.status_audit,
            status_label: AUDIT_STATUS_LABEL[audit.status_audit],
            ...buildReview(audit.initial_data, items, history),
        };
    }

    // ─── Etapa 2 — Conferência ──────────────────────────────────────

    /** Registra a conferência de um ativo previsto (uma por ativo por auditoria). */
    async registerItem(auditId, data, currentUser) {
        return this._saveItem(auditId, data, currentUser, { isUpdate: false });
    }

    /** Edita a conferência já registrada. Campos não enviados mantêm o valor atual. */
    async updateItem(auditId, activeId, data, currentUser) {
        return this._saveItem(auditId, { ...data, active_id_fk: Number(activeId) }, currentUser, { isUpdate: true });
    }

    /** @private */
    async _saveItem(auditId, data, currentUser, { isUpdate }) {
        console.log(data)
        const gappUser = await this._resolveGappUser(currentUser);
        const audit = await this._getScopedAudit(auditId, gappUser);
        const activeId = Number(data.active_id_fk);

        console.log(audit)

        const expected = (audit.initial_data?.assets ?? []).some(asset => Number(asset.active_id) === activeId);
        if (!expected) {
            throw new AppError('Este ativo não faz parte da auditoria.', 400, { code: 'GAPP_AUDIT_ACTIVE_NOT_EXPECTED' });
        }

        await this.repository.runLocked(audit.audit_id, async tx => {
            if (!tx.audit) throw new AppError('Auditoria não encontrada.', 404);
            this._assertEditable(tx.audit.status_audit);

            const current = await tx.findItem(activeId);
            if (!isUpdate && current) {
                throw new AppError('Este ativo já foi conferido nesta auditoria. Edite o registro existente.', 409, { code: 'GAPP_AUDIT_ITEM_DUPLICATED' });
            }
            if (isUpdate && !current) {
                throw new AppError('Conferência não encontrada para este ativo.', 404);
            }

            const merged = isUpdate ? mergeItem(current, data) : data;

            const { value, error } = normalizeRegistration(merged);
            if (error) throw new AppError(error, 400);

            if (value.identifier_value != null) {
                const other = await tx.findItemByIdentifier(value.identifier_type, value.identifier_value, activeId);
                if (other) {
                    throw new AppError(
                        `Identificador já informado para o ativo ${other.active_id_fk} nesta auditoria.`,
                        409,
                        { code: 'GAPP_AUDIT_IDENTIFIER_DUPLICATED', details: { active_id: other.active_id_fk } }
                    );
                }
            }

            const payload = { ...value, active_id_fk: activeId, user_register_id_fk: gappUser.user_id };
            if (isUpdate) await tx.updateItem(payload);
            else await tx.insertItem(payload);

            if (tx.audit.status_audit === AUDIT_STATUS.OPEN) {
                await tx.updateStatus(AUDIT_STATUS.OPEN, AUDIT_STATUS.IN_PROGRESS);
            }
        });

        return this.getAuditById(audit.audit_id, currentUser);
    }

    // ─── Etapa 4 — Finalização ──────────────────────────────────────

    /**
     * Consolida as conferências em `final_data` e fecha a auditoria (transacional).
     * Pendentes e conflitos com auditorias anteriores entram como divergência;
     * identificador repetido dentro da auditoria impede a finalização.
     */
    async finishAudit(auditId, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        const audit = await this._getScopedAudit(auditId, gappUser);

        await this.repository.runLocked(audit.audit_id, async tx => {
            if (!tx.audit) throw new AppError('Auditoria não encontrada.', 404);
            this._assertEditable(tx.audit.status_audit);

            const items = await tx.listItems();

            const duplicates = findDuplicateIdentifiers(items);
            if (duplicates.length) {
                throw new AppError('Há identificadores repetidos entre ativos desta auditoria. Corrija antes de finalizar.', 409, {
                    code: 'GAPP_AUDIT_IDENTIFIER_DUPLICATED',
                    details: { duplicates },
                });
            }

            const history = await tx.findIdentifierHistory(identifierPairs(items));
            const finalData = buildFinalData(audit.audit_id, tx.audit.initial_data, items, history);

            const { updated } = await tx.closeAudit({ finalData, userId: gappUser.user_id, status: AUDIT_STATUS.FINISHED });
            if (!updated) throw new AppError('Status da auditoria não permite finalização.', 409, { code: 'GAPP_AUDIT_LOCKED' });
        });

        return this.getAuditById(audit.audit_id, currentUser);
    }

    /** Cancela a auditoria. As conferências ficam preservadas (rastreabilidade). */
    async cancelAudit(auditId, data, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        const audit = await this._getScopedAudit(auditId, gappUser);

        await this.repository.runLocked(audit.audit_id, async tx => {
            if (!tx.audit) throw new AppError('Auditoria não encontrada.', 404);
            this._assertEditable(tx.audit.status_audit);

            const items = await tx.listItems();
            const finalData = buildCanceledData(audit.audit_id, tx.audit.initial_data, items, data?.reason);

            const { updated } = await tx.closeAudit({ finalData, userId: gappUser.user_id, status: AUDIT_STATUS.CANCELED });
            if (!updated) throw new AppError('Status da auditoria não permite cancelamento.', 409, { code: 'GAPP_AUDIT_LOCKED' });
        });

        return this.getAuditById(audit.audit_id, currentUser);
    }
}

module.exports = { GappActiveAuditUseCases };
