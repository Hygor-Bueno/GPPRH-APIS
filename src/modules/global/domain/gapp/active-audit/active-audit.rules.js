/**
 * @fileoverview Regras puras da auditoria de ativos GAPP (sem I/O).
 *
 * - Status e transições permitidas.
 * - Normalização/validação da conferência (identificador, conservação, itens adicionais).
 * - Revisão (pendentes, divergências, resumo de conservação) e o JSON final.
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

const DIVERGENCE_TYPE = Object.freeze({
    PENDING: 'PENDING',                         // previsto e não conferido
    DUPLICATE_IDENTIFIER: 'DUPLICATE_IDENTIFIER', // mesmo identificador em 2+ ativos da auditoria
    IDENTIFIER_CONFLICT: 'IDENTIFIER_CONFLICT',   // identificador já registrado para outro ativo em auditoria finalizada
    TRANSFERRED: 'TRANSFERRED',                   // ativo encontrado como transferido (destino registrado na conferência)
});

const MAX_ACTIVES_PER_AUDIT = 1000;
const MAX_IDENTIFIER_LENGTH = 150;
const ADDITIONAL_ITEMS_LIMITS = Object.freeze({ maxKeys: 50, maxKeyLength: 60, maxStringLength: 200 });

/**
 * Destino da transferência — só os códigos do Protheus (filial, centro de
 * custo e matrícula do responsável); os nomes o front resolve pelos códigos.
 * Tudo opcional, menos o motivo: o que faltar no Protheus não impede o registro.
 */
const TRANSFER_FIELD_LIMITS = Object.freeze({
    transfer_branch_code: 10,
    transfer_costcenter_code: 20,
    transfer_responsible_registration: 20,
});
const TRANSFER_FIELDS = Object.freeze(Object.keys(TRANSFER_FIELD_LIMITS));
const MAX_TRANSFER_REASON = 500;

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
 * Fotografia do ativo guardada em `initial_data` — só o que vem do cadastro.
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
        units_id_fk: row.units_id_fk ?? null,
        unit_name: row.unit_name ?? null,
        used_in: row.used_in ?? null,
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

/**
 * Transferência: `is_transfer` 1 exige motivo; 0 limpa motivo e destino.
 * @returns {{ value?: object, error?: string }}
 */
function normalizeTransfer(data) {
    const isTransfer = data.is_transfer === true || Number(data.is_transfer) === 1;
    const empty = Object.fromEntries(TRANSFER_FIELDS.map(field => [field, null]));
    if (!isTransfer) return { value: { is_transfer: 0, transfer_reason: null, ...empty } };

    const reason = trimOrNull(data.transfer_reason);
    if (!reason) return { error: 'Informe o motivo da transferência.' };
    if (reason.length > MAX_TRANSFER_REASON) {
        return { error: `O motivo da transferência deve ter no máximo ${MAX_TRANSFER_REASON} caracteres.` };
    }

    const value = { is_transfer: 1, transfer_reason: reason };
    for (const [field, limit] of Object.entries(TRANSFER_FIELD_LIMITS)) {
        value[field] = trimOrNull(data[field]);
        if (value[field] && value[field].length > limit) {
            return { error: `O campo '${field}' deve ter no máximo ${limit} caracteres.` };
        }
    }
    return { value };
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

    const additional = validateAdditionalItems(data.additional_items);
    if (additional.error) return { error: additional.error };

    const transfer = normalizeTransfer(data);
    if (transfer.error) return { error: transfer.error };

    return {
        value: {
            identifier_type: identifierType,
            identifier_value: identifierValue,
            asset_condition: data.asset_condition,
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

/**
 * Transferência consolidada: origem (unidade do ativo na fotografia da abertura)
 * × destino (códigos do Protheus), motivo e matrícula do responsável. `null` quando não houve.
 */
function toTransfer(item, asset) {
    if (!Number(item.is_transfer)) return null;
    return {
        reason: item.transfer_reason ?? null,
        origin: { unit_id: asset?.units_id_fk ?? null, unit_name: asset?.unit_name ?? null },
        destination: {
            branch_code: item.transfer_branch_code ?? null,
            costcenter_code: item.transfer_costcenter_code ?? null,
        },
        responsible_registration: item.transfer_responsible_registration ?? null,
    };
}

function toFinalItem(item, asset) {
    return {
        active_id: Number(item.active_id_fk),
        identifier_type: item.identifier_type,
        identifier_value: item.identifier_value ?? null,
        condition: item.asset_condition ?? null,
        additional_items: item.additional_items ?? null,
        observations: item.observations ?? null,
        user_register_id: item.user_register_id_fk ?? null,
        date_register: item.date_register ?? null,
        transfer: toTransfer(item, asset),
    };
}

/** Itens consolidados, cada um com o ativo da fotografia (origem da transferência). */
function toFinalItems(initialData, items) {
    const assetById = new Map((initialData?.assets ?? []).map(asset => [Number(asset.active_id), asset]));
    return items.map(item => toFinalItem(item, assetById.get(Number(item.active_id_fk))));
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

    const pending = assets
        .filter(asset => !registered.has(Number(asset.active_id)))
        .map(asset => ({ active_id: asset.active_id, brand: asset.brand, model: asset.model }));

    const conditions = Object.fromEntries(ASSET_CONDITIONS.map(condition => [condition, 0]));
    for (const item of items) {
        if (item.asset_condition in conditions) conditions[item.asset_condition] += 1;
    }

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
            message: 'Ativo transferido para outra unidade/setor.',
        })),
    ];

    return {
        quantity_expected: assets.length,
        quantity_found: registered.size,
        quantity_pending: pending.length,
        quantity_transferred: transferred.length,
        pending,
        conditions,
        duplicates,
        divergences,
        has_divergence: divergences.length > 0,
        items: toFinalItems(initialData, items),
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
        quantity_found: review.quantity_found,
        quantity_pending: review.quantity_pending,
        quantity_transferred: review.quantity_transferred,
        has_divergence: review.has_divergence,
        conditions: review.conditions,
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
        items: toFinalItems(initialData, items),
    };
}

module.exports = {
    AUDIT_STATUS,
    AUDIT_STATUS_LABEL,
    EDITABLE_STATUSES,
    IDENTIFIER_TYPE,
    IDENTIFIER_TYPES,
    ASSET_CONDITIONS,
    DIVERGENCE_TYPE,
    MAX_ACTIVES_PER_AUDIT,
    isEditableStatus,
    lockedStatusMessage,
    normalizeActiveIds,
    toSnapshotAsset,
    identifierKey,
    normalizeRegistration,
    validateAdditionalItems,
    findDuplicateIdentifiers,
    findIdentifierConflicts,
    buildReview,
    buildFinalData,
    buildCanceledData,
};
