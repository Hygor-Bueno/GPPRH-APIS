/**
 * @fileoverview Casos de uso — Auditoria de Ativos / Inventário (GAPP).
 *
 * - Usuários (`user_open_id_fk`, `user_register_id_fk`, `user_finish_id_fk`)
 *   são sempre o `gapp_user.user_id` do usuário autenticado — nunca do body.
 * - Escopo: só ativos e auditorias do `work_group_fk` do usuário.
 * - Abertura: unidade obrigatória e setor opcional dizem onde a auditoria
 *   acontece, mas NÃO filtram ativos; só classe/tipo filtram. Com
 *   `active_ids` só os escolhidos (precisam ser da classe/tipo); sem, todos
 *   os ativos do grupo na classe/tipo entram automaticamente.
 * - O cadastro original (`gapp_active`) nunca é alterado pela auditoria; a
 *   origem da transferência é lida dele.
 * - Depois da abertura, toda escrita roda em `repository.runLocked`
 *   (transação + `FOR UPDATE` na auditoria).
 * - Finalização/cancelamento: grava `final_data`, relê e confere contra a
 *   tabela temporária e só então a limpa — tudo na mesma transação. Depois
 *   disso as conferências são servidas a partir do `final_data`.
 *
 * @module modules/global/application/gapp/active-audit/gapp-active-audit.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const {
    AUDIT_STATUS, AUDIT_STATUS_LABEL, MAX_ACTIVES_PER_AUDIT,
    lockedStatusMessage, normalizeOpenAudit, validateAuditScope, validateTransferDestination,
    isSameDepartment, toSnapshotAsset,
    normalizeRegistration, findDuplicateIdentifiers,
    buildReview, buildFinalData, buildCanceledData, verifyFinalData, itemsFromFinalData,
} = require('../../../domain/gapp/active-audit/active-audit.rules');

/** Pares (tipo, valor) dos itens com identificador — para buscar conflitos no histórico. */
const identifierPairs = items => items
    .filter(item => item.identifier_value != null && String(item.identifier_value).trim() !== '')
    .map(item => [item.identifier_type, String(item.identifier_value).trim()]);

/** Campos que a edição pode trocar; o que não vier mantém o valor atual (inclusive a transferência). */
const EDITABLE_ITEM_FIELDS = [
    'identifier_type', 'identifier_value', 'asset_condition', 'lifecycle_status', 'additional_items', 'observations',
    'is_transfer', 'transfer_reason', 'transfer_dep_id_fk',
];
const mergeItem = (current, data) =>
    Object.fromEntries(EDITABLE_ITEM_FIELDS.map(field => [field, data[field] !== undefined ? data[field] : current[field]]));

/**
 * 409 quando o identificador já pertence a outro ativo — nesta auditoria ou
 * em outra (aberta ou finalizada): um identificador valida um único ativo.
 */
function identifierInUseError(other, auditId) {
    const sameAudit = Number(other.audit_id_fk) === Number(auditId);
    const where = sameAudit ? 'nesta auditoria' : `na auditoria #${other.audit_id_fk}`;
    return new AppError(`Identificador já usado para o ativo ${other.active_id_fk} ${where}.`, 409, {
        code: sameAudit ? 'GAPP_AUDIT_IDENTIFIER_DUPLICATED' : 'GAPP_AUDIT_IDENTIFIER_IN_USE',
        details: { active_id: other.active_id_fk, audit_id: other.audit_id_fk },
    });
}

const withStatusLabel = audit => audit && ({ ...audit, status_label: AUDIT_STATUS_LABEL[audit.status_audit] ?? null });

const isClosed = status => [AUDIT_STATUS.FINISHED, AUDIT_STATUS.CANCELED].includes(Number(status));

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
     * Abre a auditoria com a fotografia dos ativos previstos.
     * @param {{ unit_id_fk: number, dep_id_fk?: number, id_active_class_fk?: number,
     *           active_type_id_fk?: number, active_ids?: number[] }} data
     */
    async openAudit(data, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);

        const { value, error } = normalizeOpenAudit(data);
        if (error) throw new AppError(error, 400);
        const { scope, active_ids: activeIds } = value;

        const refs = await this.repository.findRefs(scope);
        const scopeError = validateAuditScope(scope, refs);
        if (scopeError) throw new AppError(scopeError, 400, { code: 'GAPP_AUDIT_INVALID_SCOPE' });

        // Sem lista: todos do escopo, buscando um a mais que o teto para saber se estourou.
        const rows = await this.repository.findActivesForAudit({
            scope,
            workGroupFk: gappUser.work_group_fk,
            activeIds,
            limit: activeIds ? activeIds.length : MAX_ACTIVES_PER_AUDIT + 1,
        });

        if (activeIds) {
            const found = new Set(rows.map(row => Number(row.active_id)));
            const missing = activeIds.filter(id => !found.has(id));
            if (missing.length) {
                throw new AppError(
                    `Ativo(s) não encontrado(s) ou fora do tipo/classe selecionados: ${missing.join(', ')}.`,
                    404,
                    { code: 'GAPP_AUDIT_ACTIVE_NOT_FOUND', details: { active_ids: missing } }
                );
            }
        } else {
            if (!rows.length) {
                throw new AppError('Nenhum ativo encontrado para o tipo/classe selecionados.', 404, {
                    code: 'GAPP_AUDIT_NO_ACTIVES',
                });
            }
            if (rows.length > MAX_ACTIVES_PER_AUDIT) {
                throw new AppError(
                    `A seleção tem mais de ${MAX_ACTIVES_PER_AUDIT} ativos. Refine por tipo ou classe, ou escolha os ativos.`,
                    400,
                    { code: 'GAPP_AUDIT_TOO_MANY_ACTIVES' }
                );
            }
        }

        const initialData = { scope, assets: rows.map(toSnapshotAsset) };
        const { insertId } = await this.repository.createAudit({
            user_open_id_fk: gappUser.user_id,
            unit_id_fk: scope.unit_id_fk,
            dep_id_fk: scope.dep_id_fk,
            id_active_class_fk: scope.id_active_class_fk,
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

    /**
     * Cabeçalho + initial_data + final_data + conferências.
     * Aberta: conferências da temporária. Encerrada: do `final_data`
     * (a temporária foi limpa), no mesmo formato.
     */
    async getAuditById(auditId, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        const audit = await this._getScopedAudit(auditId, gappUser);
        const items = isClosed(audit.status_audit)
            ? await this._closedItems(audit)
            : await this.repository.listItems(audit.audit_id);
        return { ...withStatusLabel(audit), items };
    }

    /** @private Conferências do final_data; nomes faltantes (formato antigo) são resolvidos no gapp_user. */
    async _closedItems(audit) {
        const items = itemsFromFinalData(audit.audit_id, audit.final_data);
        const missing = [...new Set(items
            .filter(item => item.user_register_id_fk != null && !item.user_register_name)
            .map(item => Number(item.user_register_id_fk)))];
        if (!missing.length) return items;

        const names = new Map((await this.repository.findUserNames(missing)).map(row => [Number(row.user_id), row.name]));
        return items.map(item => (item.user_register_name || item.user_register_id_fk == null
            ? item
            : { ...item, user_register_name: names.get(Number(item.user_register_id_fk)) ?? null }));
    }

    // ─── Etapa 3 — Revisão ──────────────────────────────────────────

    /** Previstos, conferidos, pendentes, divergências e resumos de conservação e ciclo de vida. */
    async getReview(auditId, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        const audit = await this._getScopedAudit(auditId, gappUser);

        // Finalizada/cancelada: a revisão é o que foi consolidado no fechamento.
        if (isClosed(audit.status_audit)) {
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
        const gappUser = await this._resolveGappUser(currentUser);
        const audit = await this._getScopedAudit(auditId, gappUser);
        const activeId = Number(data.active_id_fk);

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

            if (value.is_transfer) await this._resolveTransfer(tx, activeId, current, value);

            if (value.identifier_value != null) {
                const other = await tx.findItemByIdentifier(value.identifier_type, value.identifier_value, activeId);
                if (other) throw identifierInUseError(other, tx.audit.audit_id);
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

    /**
     * @private Completa a transferência em `value` (mutando-o):
     * - setor de destino existe (ele já diz empresa e unidade);
     * - origem = setor do ativo em gapp_active.used_in (mantém a já gravada numa edição);
     * - destino precisa ser diferente da origem.
     */
    async _resolveTransfer(tx, activeId, current, value) {
        const refs = await tx.findRefs({ dep_id_fk: value.transfer_dep_id_fk });
        const destinationError = validateTransferDestination(value, refs);
        if (destinationError) throw new AppError(destinationError, 400, { code: 'GAPP_AUDIT_INVALID_TRANSFER' });
        value.transfer_origin_dep_id_fk = await this._transferOrigin(tx, activeId, current);

        if (isSameDepartment(value.transfer_dep_id_fk, value.transfer_origin_dep_id_fk)) {
            throw new AppError('O setor de destino é o mesmo em que o ativo já está.', 400, {
                code: 'GAPP_AUDIT_INVALID_TRANSFER',
            });
        }
    }

    /** @private Setor de origem: o já gravado numa transferência existente; senão, `gapp_active.used_in`. */
    async _transferOrigin(tx, activeId, current) {
        if (current && Number(current.is_transfer) === 1) return current.transfer_origin_dep_id_fk ?? null;
        const origin = await tx.findActiveLocation(activeId);
        if (!origin) throw new AppError('Ativo não encontrado no cadastro.', 404);
        return origin.used_in ?? null;
    }

    // ─── Etapa 4 — Finalização ──────────────────────────────────────

    /**
     * @private Encerra na transação: grava final_data, relê e confere contra a
     * temporária, e só então a limpa. Qualquer falha desfaz tudo (ROLLBACK) —
     * as conferências continuam na temporária e a auditoria continua aberta.
     */
    async _closeAndClear(tx, { finalData, userId, status, items }) {
        const { updated } = await tx.closeAudit({ finalData, userId, status });
        if (!updated) {
            const action = status === AUDIT_STATUS.FINISHED ? 'finalização' : 'cancelamento';
            throw new AppError(`Status da auditoria não permite ${action}.`, 409, { code: 'GAPP_AUDIT_LOCKED' });
        }

        const saved = await tx.getFinalData();
        const problems = verifyFinalData(saved, items);
        if (problems.length) {
            throw new AppError('Os dados consolidados não conferem com as conferências registradas. Nada foi alterado.', 500, {
                code: 'GAPP_AUDIT_FINAL_DATA_MISMATCH',
                details: { problems },
            });
        }

        const { deleted } = await tx.deleteItems();
        if (deleted !== items.length) {
            throw new AppError('Quantidade de conferências apagadas diferente da consolidada. Nada foi alterado.', 500, {
                code: 'GAPP_AUDIT_CLEANUP_MISMATCH',
                details: { expected: items.length, deleted },
            });
        }
    }

    /**
     * Consolida as conferências em `final_data`, fecha a auditoria e limpa a
     * temporária (transacional). Pendentes e conflitos com auditorias
     * anteriores entram como divergência; identificador repetido dentro da
     * auditoria impede a finalização.
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

            await this._closeAndClear(tx, { finalData, userId: gappUser.user_id, status: AUDIT_STATUS.FINISHED, items });
        });

        return this.getAuditById(audit.audit_id, currentUser);
    }

    /**
     * Cancela a auditoria. As conferências já feitas ficam no `final_data`
     * (rastreabilidade) e a temporária é limpa, como na finalização.
     */
    async cancelAudit(auditId, data, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        const audit = await this._getScopedAudit(auditId, gappUser);

        await this.repository.runLocked(audit.audit_id, async tx => {
            if (!tx.audit) throw new AppError('Auditoria não encontrada.', 404);
            this._assertEditable(tx.audit.status_audit);

            const items = await tx.listItems();
            const finalData = buildCanceledData(audit.audit_id, tx.audit.initial_data, items, data?.reason);

            await this._closeAndClear(tx, { finalData, userId: gappUser.user_id, status: AUDIT_STATUS.CANCELED, items });
        });

        return this.getAuditById(audit.audit_id, currentUser);
    }
}

module.exports = { GappActiveAuditUseCases };
