/**
 * @fileoverview Regras puras da auditoria de ativos GAPP (sem I/O).
 *
 * - Status e transições permitidas.
 * - Abertura: escopo (unidade, setor, classe, tipo) e seleção MANUAL × AUTO.
 * - Normalização/validação da conferência (identificador, conservação, ciclo
 *   de vida, itens adicionais, transferência GAPP).
 * - Revisão (pendentes, divergências, resumos) e o JSON final.
 * - Conferência do `final_data` gravado antes de limpar a tabela temporária,
 *   e leitura das conferências de volta a partir dele.
 *
 * @module modules/global/domain/gapp/active-audit/active-audit.rules
 */

const AUDIT_STATUS = Object.freeze({
    OPEN: 0,          // ABERTA
    IN_PROGRESS: 1,   // EM ANDAMENTO
    FINISHED: 2,      // FINALIZADA
    CANCELED: 3,      // CANCELADA
});

const AUDIT_STATUS_LABEL = Object.freeze({
    [AUDIT_STATUS.OPEN]: 'ABERTA',
    [AUDIT_STATUS.IN_PROGRESS]: 'EM ANDAMENTO',
    [AUDIT_STATUS.FINISHED]: 'FINALIZADA',
    [AUDIT_STATUS.CANCELED]: 'CANCELADA',
});

/** Só ABERTA e EM ANDAMENTO aceitam conferência, finalização e cancelamento. */
const EDITABLE_STATUSES = Object.freeze([AUDIT_STATUS.OPEN, AUDIT_STATUS.IN_PROGRESS]);

const IDENTIFIER_TYPE = Object.freeze({
    SERIAL: 'SERIAL',
    PATRIMONIO: 'PATRIMONIO',
    SEM_IDENTIFICACAO: 'SEM_IDENTIFICACAO',
});
const IDENTIFIER_TYPES = Object.freeze(Object.values(IDENTIFIER_TYPE));

const ASSET_CONDITIONS = Object.freeze(['GOOD', 'REGULAR', 'BAD', 'UNUSABLE']);

/** Ciclo de vida do ativo identificado na conferência (CHECK ck_audit_temp_lifecycle). */
const LIFECYCLE_STATUSES = Object.freeze(['IN_USE', 'IN_STOCK', 'IN_MAINTENANCE', 'DISCARDED']);

const DIVERGENCE_TYPE = Object.freeze({
    PENDING: 'PENDING',                         // previsto e não conferido
    DUPLICATE_IDENTIFIER: 'DUPLICATE_IDENTIFIER', // mesmo identificador em 2+ ativos da auditoria
    IDENTIFIER_CONFLICT: 'IDENTIFIER_CONFLICT',   // identificador já registrado para outro ativo em auditoria finalizada
    TRANSFERRED: 'TRANSFERRED',                   // ativo encontrado como transferido (destino registrado na conferência)
    UNEXPECTED: 'UNEXPECTED',                     // ativo não previsto, incluído durante a conferência pelo identificador
});

/** Ativo incluído durante a conferência (não estava na abertura). */
const isUnexpectedAsset = asset => asset?.is_expected === false;

/**
 * Fotografia do ativo não previsto, acrescentada a `initial_data.assets` com
 * quem incluiu e quando — a partir daí ele é conferido como qualquer outro.
 */
function toUnexpectedAsset(row, userId) {
    return { ...toSnapshotAsset(row), is_expected: false, added_by: userId, added_at: new Date().toISOString() };
}

/** `initial_data` com o ativo não previsto no fim da lista. */
const appendUnexpectedAsset = (initialData, asset) => ({ ...initialData, assets: [...(initialData?.assets ?? []), asset] });

const MAX_ACTIVES_PER_AUDIT = 1000;
const MAX_IDENTIFIER_LENGTH = 150;
const ADDITIONAL_ITEMS_LIMITS = Object.freeze({ maxKeys: 50, maxKeyLength: 60, maxStringLength: 200 });

const MAX_TRANSFER_REASON = 500;

/** Inteiro positivo ou `null` (vazio). `undefined` quando o valor é inválido. */
function positiveIntOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : undefined;
}

const isEditableStatus = status => EDITABLE_STATUSES.includes(Number(status));

/**
 * Motivo de recusa de alteração conforme o status; `null` se editável.
 * @returns {string|null}
 */
function lockedStatusMessage(status) {
    if (Number(status) === AUDIT_STATUS.FINISHED) return 'Auditoria finalizada não pode ser alterada.';
    if (Number(status) === AUDIT_STATUS.CANCELED) return 'Auditoria cancelada não pode receber registros.';
    if (!isEditableStatus(status)) return 'Status da auditoria não permite alteração.';
    return null;
}

/**
 * Lista de ids da abertura: inteiros positivos, sem repetição, dentro do teto.
 * @returns {{ ids?: number[], error?: string }}
 */
function normalizeActiveIds(input) {
    if (!Array.isArray(input) || input.length === 0) {
        return { error: "O campo 'active_ids' deve ser uma lista com ao menos um ativo." };
    }
    const ids = [];
    for (const raw of input) {
        const id = Number(raw);
        if (!Number.isInteger(id) || id <= 0) {
            return { error: `Id de ativo inválido em 'active_ids': ${raw}.` };
        }
        if (!ids.includes(id)) ids.push(id);
    }
    if (ids.length > MAX_ACTIVES_PER_AUDIT) {
        return { error: `Uma auditoria aceita no máximo ${MAX_ACTIVES_PER_AUDIT} ativos.` };
    }
    return { ids };
}

/**
 * Filtros da abertura sobre gapp_active. Unidade, setor e classe ficam no
 * cabeçalho; o tipo só filtra (vem da classe: gapp_active_class.active_type_id_fk)
 * e fica registrado em `initial_data.scope`.
 */
const AUDIT_SCOPE_FIELDS = Object.freeze(['unit_id_fk', 'dep_id_fk', 'id_active_class_fk', 'active_type_id_fk']);

/**
 * Corpo da abertura. A unidade é obrigatória; setor, classe e tipo refinam o escopo.
 * Com `active_ids` → só os escolhidos (precisam estar no escopo);
 * sem `active_ids` (ou lista vazia) → `active_ids: null` = todos os ativos do escopo.
 *
 * @returns {{ value?: { scope: object, active_ids: number[]|null }, error?: string }}
 */
function normalizeOpenAudit(data = {}) {
    const scope = {};
    for (const field of AUDIT_SCOPE_FIELDS) {
        const value = positiveIntOrNull(data[field]);
        if (value === undefined) return { error: `O campo '${field}' deve ser um id válido.` };
        scope[field] = value;
    }
    if (!scope.unit_id_fk) return { error: 'Informe a unidade onde a auditoria será realizada.' };

    const hasIds = Array.isArray(data.active_ids) ? data.active_ids.length > 0 : data.active_ids != null;
    if (!hasIds) return { value: { scope, active_ids: null } };

    const { ids, error } = normalizeActiveIds(data.active_ids);
    if (error) return { error };
    return { value: { scope, active_ids: ids } };
}

/**
 * Confere as referências do escopo lidas do banco.
 * `refs` = { unit, department, activeClass, activeType } (null quando não achou).
 * @returns {string|null} mensagem de erro
 */
function validateAuditScope(scope, refs) {
    if (!refs.unit) return 'Unidade não encontrada.';
    if (scope.dep_id_fk) {
        if (!refs.department) return 'Setor não encontrado.';
        if (Number(refs.department.unit_id_fk) !== Number(scope.unit_id_fk)) return 'O setor informado não pertence à unidade.';
    }
    if (scope.id_active_class_fk && !refs.activeClass) return 'Classe de ativo não encontrada.';
    if (scope.active_type_id_fk) {
        if (!refs.activeType) return 'Tipo de ativo não encontrado.';
        if (refs.activeClass && Number(refs.activeClass.active_type_id_fk) !== Number(scope.active_type_id_fk)) {
            return 'A classe de ativo informada não pertence ao tipo.';
        }
    }
    return null;
}

/**
 * Destino da transferência lido do banco: o setor existe. `refs` = { department }.
 * @returns {string|null}
 */
function validateTransferDestination(value, refs) {
    if (!Number(value.is_transfer)) return null;
    return refs.department ? null : 'Setor de destino não encontrado.';
}

/** Mesmo setor (NULL = NULL), como o `<=>` do CHECK. O setor já diz empresa e unidade. */
const isSameDepartment = (depA, depB) => (depA ?? null) == (depB ?? null); // eslint-disable-line eqeqeq

/**
 * Fotografia do ativo guardada em `initial_data` — só o que vem do cadastro.
 * Local = setor (`used_in`) e o caminho dele; `units_id_fk` (loja de compra) não entra.
 */
function toSnapshotAsset(row) {
    return {
        active_id: row.active_id,
        brand: row.brand ?? null,
        model: row.model ?? null,
        number_nf: row.number_nf ?? null,
        date_purchase: row.date_purchase ?? null,
        value_purchase: row.value_purchase != null ? Number(row.value_purchase) : null,
        status_active: row.status_active ?? null,
        is_vehicle: row.is_vehicle ?? null,
        id_active_class_fk: row.id_active_class_fk ?? null,
        desc_active_class: row.desc_active_class ?? null,
        active_type_id_fk: row.active_type_id_fk ?? null,
        desc_active_type: row.desc_active_type ?? null,
        used_in: row.used_in ?? null,
        dep_name: row.dep_name ?? null,
        dep_path: row.dep_path ?? null,
        work_group_fk: row.work_group_fk ?? null,
    };
}

/** Chave de comparação de identificador (ignora caixa e espaços nas pontas). */
const identifierKey = (type, value) => `${type}|${String(value ?? '').trim().toUpperCase()}`;

/** Identificador que entra na checagem de repetição (com valor). */
const hasComparableIdentifier = item =>
    item.identifier_type !== IDENTIFIER_TYPE.SEM_IDENTIFICACAO
    && item.identifier_value != null
    && String(item.identifier_value).trim() !== '';

function validateAdditionalItems(value) {
    if (value == null) return { value: null };
    if (typeof value !== 'object' || Array.isArray(value)) {
        return { error: "O campo 'additional_items' deve ser um objeto (ex.: { \"charger\": true })." };
    }
    const entries = Object.entries(value);
    const { maxKeys, maxKeyLength, maxStringLength } = ADDITIONAL_ITEMS_LIMITS;
    if (entries.length > maxKeys) {
        return { error: `'additional_items' aceita no máximo ${maxKeys} itens.` };
    }
    for (const [key, item] of entries) {
        if (!key.trim() || key.length > maxKeyLength) {
            return { error: `Nome de item adicional inválido: '${key}'.` };
        }
        const ok = item === null
            || typeof item === 'boolean'
            || (typeof item === 'number' && Number.isFinite(item))
            || (typeof item === 'string' && item.length <= maxStringLength);
        if (!ok) {
            return { error: `Valor inválido no item adicional '${key}' (use verdadeiro/falso, número ou texto até ${maxStringLength} caracteres).` };
        }
    }
    return { value: entries.length ? value : null };
}

const trimOrNull = value => (value == null ? null : String(value).trim() || null);

/** Colunas de transferência gravadas na conferência (origem é preenchida pelo use-case). */
const TRANSFER_COLUMNS = Object.freeze([
    'transfer_reason', 'transfer_origin_dep_id_fk', 'transfer_dep_id_fk',
]);

/**
 * Transferência GAPP: `is_transfer` 1 exige motivo e setor de destino; 0 limpa
 * tudo. A origem NÃO vem do cliente — o use-case lê o setor atual do ativo
 * (`gapp_active.used_in`). Não há unidade: o setor já diz empresa e unidade.
 * @returns {{ value?: object, error?: string }}
 */
function normalizeTransfer(data) {
    const isTransfer = data.is_transfer === true || Number(data.is_transfer) === 1;
    if (!isTransfer) {
        return { value: { is_transfer: 0, ...Object.fromEntries(TRANSFER_COLUMNS.map(column => [column, null])) } };
    }

    const reason = trimOrNull(data.transfer_reason);
    if (!reason) return { error: 'Informe o motivo da transferência.' };
    if (reason.length > MAX_TRANSFER_REASON) {
        return { error: `O motivo da transferência deve ter no máximo ${MAX_TRANSFER_REASON} caracteres.` };
    }

    const depId = positiveIntOrNull(data.transfer_dep_id_fk);
    if (!depId) return { error: 'Selecione o setor de destino da transferência.' };

    return {
        value: {
            is_transfer: 1,
            transfer_reason: reason,
            transfer_origin_dep_id_fk: null,
            transfer_dep_id_fk: depId,
        },
    };
}

/**
 * Normaliza e valida uma conferência já mesclada com o que existia (no PUT).
 * @returns {{ value?: object, error?: string }}
 */
function normalizeRegistration(data) {
    const identifierType = data.identifier_type;
    if (!IDENTIFIER_TYPES.includes(identifierType)) {
        return { error: `O campo 'identifier_type' deve ser um destes valores: ${IDENTIFIER_TYPES.join(', ')}.` };
    }

    let identifierValue = data.identifier_value == null ? '' : String(data.identifier_value).trim();
    if (identifierType === IDENTIFIER_TYPE.SEM_IDENTIFICACAO) {
        identifierValue = null;
    } else if (!identifierValue) {
        return { error: `Informe o número de ${identifierType === IDENTIFIER_TYPE.SERIAL ? 'série' : 'patrimônio'} do ativo.` };
    } else if (identifierValue.length > MAX_IDENTIFIER_LENGTH) {
        return { error: `O identificador deve ter no máximo ${MAX_IDENTIFIER_LENGTH} caracteres.` };
    }

    if (!ASSET_CONDITIONS.includes(data.asset_condition)) {
        return { error: `O campo 'asset_condition' deve ser um destes valores: ${ASSET_CONDITIONS.join(', ')}.` };
    }

    if (!LIFECYCLE_STATUSES.includes(data.lifecycle_status)) {
        return { error: `O campo 'lifecycle_status' deve ser um destes valores: ${LIFECYCLE_STATUSES.join(', ')}.` };
    }

    const additional = validateAdditionalItems(data.additional_items);
    if (additional.error) return { error: additional.error };

    const transfer = normalizeTransfer(data);
    if (transfer.error) return { error: transfer.error };

    return {
        value: {
            identifier_type: identifierType,
            identifier_value: identifierValue,
            asset_condition: data.asset_condition,
            lifecycle_status: data.lifecycle_status,
            additional_items: additional.value,
            observations: trimOrNull(data.observations),
            ...transfer.value,
        },
    };
}

/**
 * Identificadores repetidos entre ativos diferentes da mesma auditoria.
 * @returns {Array<{ identifier_type: string, identifier_value: string, active_ids: number[] }>}
 */
function findDuplicateIdentifiers(items) {
    const groups = new Map();
    for (const item of items) {
        if (!hasComparableIdentifier(item)) continue;
        const key = identifierKey(item.identifier_type, item.identifier_value);
        if (!groups.has(key)) {
            groups.set(key, { identifier_type: item.identifier_type, identifier_value: String(item.identifier_value).trim(), active_ids: [] });
        }
        groups.get(key).active_ids.push(Number(item.active_id_fk));
    }
    return [...groups.values()].filter(group => group.active_ids.length > 1);
}

/**
 * Conflitos com auditorias finalizadas anteriores: o identificador conferido
 * aqui já foi registrado para OUTRO ativo. `history` vem do repositório.
 */
function findIdentifierConflicts(items, history = []) {
    const byKey = new Map();
    for (const row of history) {
        const key = identifierKey(row.identifier_type, row.identifier_value);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(row);
    }

    const conflicts = [];
    for (const item of items) {
        if (!hasComparableIdentifier(item)) continue;
        const others = (byKey.get(identifierKey(item.identifier_type, item.identifier_value)) || [])
            .filter(row => Number(row.active_id_fk) !== Number(item.active_id_fk));
        if (!others.length) continue;
        conflicts.push({
            active_id: Number(item.active_id_fk),
            identifier_type: item.identifier_type,
            identifier_value: item.identifier_value,
            other_assets: [...new Set(others.map(row => Number(row.active_id_fk)))],
            audit_ids: [...new Set(others.map(row => Number(row.audit_id_fk)))],
        });
    }
    return conflicts;
}

const location = (depId, depName, depPath) => ({ dep_id: depId ?? null, dep_name: depName ?? null, dep_path: depPath ?? null });

/**
 * Transferência consolidada: origem (cadastro do ativo em gapp_active no
 * registro) × destino GAPP, com os nomes da época. `null` quando não houve.
 */
function toTransfer(item) {
    if (!Number(item.is_transfer)) return null;
    return {
        reason: item.transfer_reason ?? null,
        origin: location(item.transfer_origin_dep_id_fk, item.transfer_origin_dep_name, item.transfer_origin_dep_path),
        destination: location(item.transfer_dep_id_fk, item.transfer_dep_name, item.transfer_dep_path),
    };
}

/**
 * Conferência como fica no `final_data`. Depois da finalização a tabela
 * temporária é limpa, então este objeto precisa carregar TUDO o que a tela
 * de detalhe mostra (inclusive nomes).
 */
function toFinalItem(item) {
    return {
        active_id: Number(item.active_id_fk),
        identifier_type: item.identifier_type,
        identifier_value: item.identifier_value ?? null,
        condition: item.asset_condition ?? null,
        lifecycle_status: item.lifecycle_status ?? null,
        additional_items: item.additional_items ?? null,
        observations: item.observations ?? null,
        user_register_id: item.user_register_id_fk ?? null,
        user_register_name: item.user_register_name ?? null,
        date_register: item.date_register ?? null,
        transfer: toTransfer(item),
    };
}

const toFinalItems = items => items.map(toFinalItem);

/** Contagem por valor, com todos os valores conhecidos zerados. */
function countBy(items, field, known) {
    const counts = Object.fromEntries(known.map(value => [value, 0]));
    for (const item of items) {
        if (item[field] in counts) counts[item[field]] += 1;
    }
    return counts;
}

/**
 * Revisão da auditoria (Tela 3) — também é a base do `final_data`.
 *
 * @param {{ assets: object[] }} initialData
 * @param {object[]} items       linhas de gapp_active_audit_temp
 * @param {object[]} [history]   registros de auditorias finalizadas com os mesmos identificadores
 */
function buildReview(initialData, items, history = []) {
    const assets = initialData?.assets ?? [];
    const registered = new Set(items.map(item => Number(item.active_id_fk)));

    const unexpected = assets.filter(isUnexpectedAsset);
    const pending = assets
        .filter(asset => !registered.has(Number(asset.active_id)))
        .map(asset => ({ active_id: asset.active_id, brand: asset.brand, model: asset.model }));

    const conditions = countBy(items, 'asset_condition', ASSET_CONDITIONS);
    const lifecycles = countBy(items, 'lifecycle_status', LIFECYCLE_STATUSES);

    const duplicates = findDuplicateIdentifiers(items);
    const conflicts = findIdentifierConflicts(items, history);
    const transferred = items.filter(item => Number(item.is_transfer) === 1);

    const divergences = [
        ...pending.map(asset => ({
            type: DIVERGENCE_TYPE.PENDING,
            active_id: asset.active_id,
            message: 'Ativo previsto e não conferido.',
        })),
        ...duplicates.map(group => ({
            type: DIVERGENCE_TYPE.DUPLICATE_IDENTIFIER,
            active_ids: group.active_ids,
            identifier_type: group.identifier_type,
            identifier_value: group.identifier_value,
            message: 'Mesmo identificador informado para mais de um ativo nesta auditoria.',
        })),
        ...conflicts.map(conflict => ({
            type: DIVERGENCE_TYPE.IDENTIFIER_CONFLICT,
            ...conflict,
            message: 'Identificador já registrado para outro ativo em auditoria finalizada.',
        })),
        ...transferred.map(item => ({
            type: DIVERGENCE_TYPE.TRANSFERRED,
            active_id: Number(item.active_id_fk),
            message: 'Ativo transferido para outro setor.',
        })),
        ...unexpected.map(asset => ({
            type: DIVERGENCE_TYPE.UNEXPECTED,
            active_id: Number(asset.active_id),
            message: 'Ativo não previsto na abertura, incluído durante a conferência.',
        })),
    ];

    return {
        quantity_expected: assets.length - unexpected.length,
        quantity_unexpected: unexpected.length,
        quantity_found: registered.size,
        quantity_pending: pending.length,
        quantity_transferred: transferred.length,
        pending,
        conditions,
        lifecycles,
        duplicates,
        divergences,
        has_divergence: divergences.length > 0,
        items: toFinalItems(items),
    };
}

/**
 * JSON consolidado gravado em `final_data` na finalização.
 */
function buildFinalData(auditId, initialData, items, history = []) {
    const review = buildReview(initialData, items, history);
    return {
        audit_id: Number(auditId),
        quantity_expected: review.quantity_expected,
        quantity_unexpected: review.quantity_unexpected,
        quantity_found: review.quantity_found,
        quantity_pending: review.quantity_pending,
        quantity_transferred: review.quantity_transferred,
        has_divergence: review.has_divergence,
        conditions: review.conditions,
        lifecycles: review.lifecycles,
        items: review.items,
        pending: review.pending,
        divergences: review.divergences,
    };
}

/**
 * `final_data` de uma auditoria cancelada: guarda o motivo e o que já havia
 * sido conferido, para o histórico.
 */
function buildCanceledData(auditId, initialData, items, reason) {
    return {
        audit_id: Number(auditId),
        canceled: true,
        reason: reason ? String(reason).trim() || null : null,
        quantity_expected: initialData?.assets?.length ?? 0,
        quantity_found: items.length,
        items: toFinalItems(items),
    };
}

/** Valor comparável: número quando for numérico, `null` para vazio. */
const comparable = value => {
    if (value === undefined || value === null || value === '') return null;
    return typeof value === 'number' || /^\d+$/.test(String(value)) ? Number(value) : String(value);
};

/**
 * Confere o `final_data` relido do banco contra as conferências da tabela
 * temporária, ANTES de limpá-la. Qualquer diferença impede a limpeza (e a
 * transação inteira volta).
 *
 * @param {object|null} saved  final_data como ficou gravado
 * @param {object[]} items     linhas de gapp_active_audit_temp
 * @returns {string[]} diferenças encontradas (vazio = ok)
 */
function verifyFinalData(saved, items) {
    if (!saved || !Array.isArray(saved.items)) return ['final_data não foi gravado com a lista de conferências.'];
    if (saved.items.length !== items.length) {
        return [`final_data tem ${saved.items.length} conferência(s); a tabela temporária tem ${items.length}.`];
    }

    const byActive = new Map(saved.items.map(entry => [Number(entry.active_id), entry]));
    const problems = [];
    for (const item of items) {
        const activeId = Number(item.active_id_fk);
        const entry = byActive.get(activeId);
        if (!entry) {
            problems.push(`Ativo ${activeId} ausente do final_data.`);
            continue;
        }
        const transfer = entry.transfer ?? null;
        const pairs = [
            ['identifier_type', entry.identifier_type, item.identifier_type],
            ['identifier_value', entry.identifier_value, item.identifier_value],
            ['asset_condition', entry.condition, item.asset_condition],
            ['lifecycle_status', entry.lifecycle_status, item.lifecycle_status],
            ['is_transfer', transfer ? 1 : 0, Number(item.is_transfer) ? 1 : 0],
            ['transfer_dep_id_fk', transfer?.destination?.dep_id, Number(item.is_transfer) ? item.transfer_dep_id_fk : null],
        ];
        for (const [field, savedValue, currentValue] of pairs) {
            if (comparable(savedValue) !== comparable(currentValue)) {
                problems.push(`Ativo ${activeId}: '${field}' diverge entre final_data e a conferência.`);
            }
        }
    }
    return problems;
}

/**
 * Conferências de uma auditoria encerrada, lidas do `final_data` no mesmo
 * formato das linhas de gapp_active_audit_temp (a temporária já foi limpa).
 */
function itemsFromFinalData(auditId, finalData) {
    return (finalData?.items ?? []).map(entry => {
        const transfer = entry.transfer ?? null;
        const origin = transfer?.origin ?? {};
        const destination = transfer?.destination ?? {};
        return {
            audit_temp_id: null,
            audit_id_fk: Number(auditId),
            active_id_fk: Number(entry.active_id),
            user_register_id_fk: entry.user_register_id ?? null,
            user_register_name: entry.user_register_name ?? null,
            identifier_type: entry.identifier_type ?? null,
            identifier_value: entry.identifier_value ?? null,
            asset_condition: entry.condition ?? null,
            lifecycle_status: entry.lifecycle_status ?? null,
            additional_items: entry.additional_items ?? null,
            observations: entry.observations ?? null,
            date_register: entry.date_register ?? null,
            is_transfer: transfer ? 1 : 0,
            transfer_reason: transfer?.reason ?? null,
            transfer_origin_dep_id_fk: origin.dep_id ?? null,
            transfer_origin_dep_name: origin.dep_name ?? null,
            transfer_origin_dep_path: origin.dep_path ?? null,
            transfer_dep_id_fk: destination.dep_id ?? null,
            transfer_dep_name: destination.dep_name ?? null,
            transfer_dep_path: destination.dep_path ?? null,
        };
    });
}

module.exports = {
    AUDIT_STATUS,
    AUDIT_STATUS_LABEL,
    EDITABLE_STATUSES,
    IDENTIFIER_TYPE,
    IDENTIFIER_TYPES,
    ASSET_CONDITIONS,
    LIFECYCLE_STATUSES,
    DIVERGENCE_TYPE,
    MAX_ACTIVES_PER_AUDIT,
    TRANSFER_COLUMNS,
    isEditableStatus,
    isUnexpectedAsset,
    toUnexpectedAsset,
    appendUnexpectedAsset,
    lockedStatusMessage,
    normalizeActiveIds,
    normalizeOpenAudit,
    validateAuditScope,
    validateTransferDestination,
    isSameDepartment,
    toSnapshotAsset,
    identifierKey,
    normalizeRegistration,
    validateAdditionalItems,
    findDuplicateIdentifiers,
    findIdentifierConflicts,
    buildReview,
    buildFinalData,
    buildCanceledData,
    verifyFinalData,
    itemsFromFinalData,
};
