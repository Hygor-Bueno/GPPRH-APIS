/**
 * @fileoverview Casos de uso — Auditoria de Ativos / Inventário (GAPP).
 *
 * - Usuários (`user_open_id_fk`, `user_register_id_fk`, `user_finish_id_fk`)
 *   são sempre o `_user.id` do usuário autenticado (`req.user.id`) — nunca do
 *   body. O `gapp_user` só serve para achar o grupo de trabalho.
 * - Grupo: só ativos e auditorias do `work_group_fk` do usuário.
 * - Acesso (audit-access.rules): quem abriu finaliza, cancela e muda os
 *   responsáveis (vários, `gapp_active_audit_user`); quem abriu e os
 *   responsáveis conferem; o grupo todo vê.
 * - Abertura: nome, prazo opcional e escopo = lojas do Protheus (empresa,
 *   filial, centro de custo opcional), conferidas no Protheus. O escopo só
 *   registra onde a auditoria acontece; os ativos são filtrados por
 *   classe/tipo. Com `active_ids` só os escolhidos (da classe/tipo); sem,
 *   todos os ativos do grupo na classe/tipo.
 * - O cadastro original (`gapp_active`) só é alterado na finalização e se
 *   quem finaliza escolher (`apply_corrections`): `used_in` dos transferidos
 *   e `status_active = 0` dos descartados. A origem da transferência é lida dele.
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
    lockedStatusMessage, validateAuditScope, validateTransferDestination,
    isSameDepartment, toSnapshotAsset,
    normalizeRegistration, findDuplicateIdentifiers,
    buildReview, buildCorrections, buildFinalData, buildCanceledData, verifyFinalData, itemsFromFinalData,
} = require('../../../domain/gapp/active-audit/active-audit.rules');
const { normalizeOpenAudit, scopeNameError, isOverdue, dateKey } = require('../../../domain/gapp/active-audit/audit-opening.rules');
const {
    ACCESS_ERROR, assigneeIds, isRequester, canRegister, notRequesterMessage, NOT_ASSIGNED_MESSAGE,
} = require('../../../domain/gapp/active-audit/audit-access.rules');

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

/**
 * Cabeçalho para a API: rótulo do status, prazo vencido e o que QUEM PEDIU
 * pode fazer (`is_requester`: finalizar/cancelar/atribuir; `can_register`:
 * conferir). O prazo (DATE) sai como 'AAAA-MM-DD' — como Date viraria
 * meia-noite em UTC no JSON e o front mostraria o dia anterior.
 */
const present = (audit, now, userId) => audit && ({
    ...audit,
    date_deadline: dateKey(audit.date_deadline),
    status_label: AUDIT_STATUS_LABEL[audit.status_audit] ?? null,
    is_overdue: isOverdue(audit, now),
    assignee_ids: assigneeIds(audit),
    is_requester: isRequester(audit, userId),
    can_register: canRegister(audit, userId),
});

/** Só quem abriu: finalizar, cancelar, trocar o responsável. */
function assertRequester(audit, currentUser, action) {
    if (isRequester(audit, currentUser?.id)) return;
    throw new AppError(notRequesterMessage(action), 403, { code: ACCESS_ERROR.NOT_REQUESTER });
}

/** Conferir: quem abriu ou o responsável. */
function assertCanRegister(audit, currentUser) {
    if (canRegister(audit, currentUser?.id)) return;
    throw new AppError(NOT_ASSIGNED_MESSAGE, 403, { code: ACCESS_ERROR.NOT_ASSIGNED });
}

/** Escolhidos que não vieram: não existem, são de outro grupo ou fora da classe/tipo. */
function assertChosenFound(rows, activeIds) {
    const found = new Set(rows.map(row => Number(row.active_id)));
    const missing = activeIds.filter(id => !found.has(id));
    if (!missing.length) return;
    throw new AppError(`Ativo(s) não encontrado(s) ou fora do tipo/classe selecionados: ${missing.join(', ')}.`, 404, {
        code: 'GAPP_AUDIT_ACTIVE_NOT_FOUND', details: { active_ids: missing },
    });
}

/** "Todos os ativos": ao menos um e no máximo o teto. */
function assertAutoSelection(rows) {
    if (!rows.length) {
        throw new AppError('Nenhum ativo encontrado para o tipo/classe selecionados.', 404, { code: 'GAPP_AUDIT_NO_ACTIVES' });
    }
    if (rows.length > MAX_ACTIVES_PER_AUDIT) {
        throw new AppError(`A seleção tem mais de ${MAX_ACTIVES_PER_AUDIT} ativos. Refine por tipo ou classe, ou escolha os ativos.`, 400, {
            code: 'GAPP_AUDIT_TOO_MANY_ACTIVES',
        });
    }
}

/** Identificador repetido dentro da auditoria impede a finalização. */
function assertNoDuplicates(items) {
    const duplicates = findDuplicateIdentifiers(items);
    if (!duplicates.length) return;
    throw new AppError('Há identificadores repetidos entre ativos desta auditoria. Corrija antes de finalizar.', 409, {
        code: 'GAPP_AUDIT_IDENTIFIER_DUPLICATED',
        details: { duplicates },
    });
}

const isClosed = status => [AUDIT_STATUS.FINISHED, AUDIT_STATUS.CANCELED].includes(Number(status));

class GappActiveAuditUseCases {
    /**
     * @param {Object} deps
     * @param {import('./ports/active-audit-repository.port').ActiveAuditRepositoryPort} deps.repository
     * @param {import('../ports/gapp-user-repository.port').GappUserRepositoryPort} deps.userRepository
     * @param {import('../../gtpp/ports/gtpp-scope-name-resolver.port').GtppScopeNameResolverPort} deps.scopeNameResolver
     *        códigos do Protheus → nomes (o mesmo do escopo de tarefas do GTPP)
     * @param {() => Date} [deps.now]
     */
    constructor({ repository, userRepository, scopeNameResolver, now = () => new Date() }) {
        this.repository = repository;
        this.userRepository = userRepository;
        this.scopeNameResolver = scopeNameResolver;
        this.now = now;
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
     * Abre a auditoria (cabeçalho + lojas do escopo) com a fotografia dos ativos.
     * @param {{ audit_name: string, date_deadline?: string, scope: Array<{ company_code: string,
     *           branch_code: string, cost_center_code?: string }>, id_active_class_fk?: number,
     *           active_type_id_fk?: number, active_ids?: number[] }} data
     */
    async openAudit(data, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        const { value, error } = normalizeOpenAudit(data, this.now(), currentUser.id);
        if (error) throw new AppError(error, 400);

        await this._assertOpeningRefs(value, gappUser);
        const rows = await this._activesForAudit(value, gappUser);
        const initialData = { filters: value.filters, assets: rows.map(toSnapshotAsset) };
        const { insertId } = await this.repository.createAudit({
            audit: {
                audit_name: value.name,
                date_deadline: value.deadline,
                user_open_id_fk: currentUser.id,
                id_active_class_fk: value.filters.id_active_class_fk,
                initial_data: initialData,
                quantity_active: rows.length,
            },
            scope: value.scope,
            assignees: value.assignees,
        });
        return this.getAuditById(insertId, currentUser);
    }

    /** @private Classe/tipo no GAPP, lojas no Protheus (código sem nome = não existe) e responsáveis do grupo. */
    async _assertOpeningRefs({ filters, scope, assignees }, gappUser) {
        const [refs, named] = await Promise.all([
            this.repository.findRefs(filters),
            this.scopeNameResolver.resolve(scope),
            this.assertAssignable(assignees, gappUser),
        ]);
        const message = validateAuditScope(filters, refs) ?? scopeNameError(named);
        if (message) throw new AppError(message, 400, { code: 'GAPP_AUDIT_INVALID_SCOPE' });
    }

    /** Responsáveis precisam ser usuários ativos do grupo de trabalho — senão nem veriam a auditoria. */
    async assertAssignable(userIds, gappUser) {
        if (!userIds.length) return;
        const found = new Set(await this.repository.findAssignableUsers(userIds, gappUser.work_group_fk));
        const invalid = userIds.filter(id => !found.has(id));
        if (!invalid.length) return;
        throw new AppError('Responsável inválido: escolha usuários ativos do seu grupo de trabalho no GAPP.', 400, {
            code: ACCESS_ERROR.INVALID_ASSIGNEE, details: { user_ids: invalid },
        });
    }

    /** @private Ativos dos filtros (sem lista: busca um a mais que o teto para saber se estourou). */
    async _activesForAudit({ filters, active_ids: activeIds }, gappUser) {
        const rows = await this.repository.findActivesForAudit({
            scope: filters,
            workGroupFk: gappUser.work_group_fk,
            activeIds,
            limit: activeIds ? activeIds.length : MAX_ACTIVES_PER_AUDIT + 1,
        });
        if (activeIds) assertChosenFound(rows, activeIds);
        else assertAutoSelection(rows);
        return rows;
    }

    // ─── Consulta / histórico ───────────────────────────────────────

    /** `work_group_fk` nunca vem da query — é o grupo do usuário autenticado. */
    async listAudits(filters, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        const result = await this.repository.list({ ...filters, work_group_fk: gappUser.work_group_fk });
        const now = this.now();
        return { ...result, items: await this._withScope(result.items.map(audit => present(audit, now, currentUser.id))) };
    }

    /**
     * @private Lojas do escopo (com os nomes do Protheus) e responsáveis (nome e
     * foto) de cada auditoria. Uma consulta de cada para a página inteira; nome
     * que o Protheus não devolver fica null.
     */
    async _withScope(audits) {
        if (!audits.length) return audits;
        const ids = audits.map(audit => audit.audit_id);
        const [scopes, users] = await Promise.all([
            this.repository.findScopes(ids).then(rows => this.scopeNameResolver.resolve(rows)),
            this.repository.findAuditUsers(ids),
        ]);
        const ofAudit = (rows, audit) => rows.filter(row => Number(row.audit_id_fk) === Number(audit.audit_id));
        return audits.map(audit => ({
            ...audit,
            scope: ofAudit(scopes, audit),
            assignees: ofAudit(users, audit).map(({ user_id, name, file_id }) => ({ user_id, name, file_id })),
        }));
    }

    /**
     * Cabeçalho + escopo + initial_data + final_data + conferências.
     * Aberta: conferências da temporária. Encerrada: do `final_data`
     * (a temporária foi limpa), no mesmo formato.
     */
    async getAuditById(auditId, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        const audit = await this._getScopedAudit(auditId, gappUser);
        const items = isClosed(audit.status_audit)
            ? await this._closedItems(audit)
            : await this.repository.listItems(audit.audit_id);
        const [withScope] = await this._withScope([present(audit, this.now(), currentUser.id)]);
        return { ...withScope, items };
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
        assertCanRegister(audit, currentUser);
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

            const payload = { ...value, active_id_fk: activeId, user_register_id_fk: currentUser.id };
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
     * auditoria impede a finalização. Com `apply_corrections: true`, corrige
     * o cadastro dos ativos na MESMA transação e registra em `final_data.corrections`.
     * @param {{ apply_corrections?: boolean }} data
     */
    async finishAudit(auditId, data, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        const audit = await this._getScopedAudit(auditId, gappUser);
        assertRequester(audit, currentUser, 'finalizá-la');
        const apply = data?.apply_corrections === true;

        await this.repository.runLocked(audit.audit_id, async tx => {
            if (!tx.audit) throw new AppError('Auditoria não encontrada.', 404);
            this._assertEditable(tx.audit.status_audit);
            const items = await tx.listItems();
            assertNoDuplicates(items);

            const history = await tx.findIdentifierHistory(identifierPairs(items));
            const finalData = buildFinalData(audit.audit_id, tx.audit.initial_data, items, history);
            finalData.corrections = apply
                ? { applied: true, ...await tx.applyCorrections({ ...buildCorrections(items), workGroupFk: gappUser.work_group_fk }) }
                : { applied: false };
            await this._closeAndClear(tx, { finalData, userId: currentUser.id, status: AUDIT_STATUS.FINISHED, items });
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
        assertRequester(audit, currentUser, 'cancelá-la');

        await this.repository.runLocked(audit.audit_id, async tx => {
            if (!tx.audit) throw new AppError('Auditoria não encontrada.', 404);
            this._assertEditable(tx.audit.status_audit);

            const items = await tx.listItems();
            const finalData = buildCanceledData(audit.audit_id, tx.audit.initial_data, items, data?.reason);

            await this._closeAndClear(tx, { finalData, userId: currentUser.id, status: AUDIT_STATUS.CANCELED, items });
        });

        return this.getAuditById(audit.audit_id, currentUser);
    }
}

module.exports = { GappActiveAuditUseCases };
