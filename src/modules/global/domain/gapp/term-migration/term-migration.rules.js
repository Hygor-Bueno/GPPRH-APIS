/**
 * @fileoverview Regras puras da migração TEMPORÁRIA de termos de smartphone do
 * sistema legado (`GIPP.gs_smartphone`) para `gapp_asset_term`.
 *
 * Sem I/O. Tudo o que decide "este arquivo pode virar termo de qual ativo" mora
 * aqui, para ser testado sem banco:
 *
 *   1. nome do arquivo → código antigo + nome do responsável
 *      (`1235-Fulano de Tal.pdf` → 1235, "Fulano de Tal");
 *   2. código antigo → IMEIs do legado (imei1 preferencial, imei2 alternativo);
 *   3. IMEIs → smartphone da base nova, **só** com correspondência única.
 *
 * O código antigo NUNCA é usado como id do ativo novo: as bases são diferentes.
 *
 * @module modules/global/domain/gapp/term-migration/term-migration.rules
 */

/** Situação de cada arquivo na tabela de controle. */
const MIGRATION_STATUS = Object.freeze({
    PENDING: 'pending',
    VALIDATED: 'validated',
    PROCESSING: 'processing',
    MIGRATED: 'migrated',
    ERROR: 'error',
    NOT_FOUND: 'not_found',
    IGNORED: 'ignored',
});

const ALL_STATUSES = Object.freeze(Object.values(MIGRATION_STATUS));

/** Motivo estável de cada problema — a tela filtra por ele, a `message` é só texto. */
const ISSUE = Object.freeze({
    INVALID_NAME: 'INVALID_NAME',
    LEGACY_NOT_FOUND: 'LEGACY_NOT_FOUND',
    LEGACY_WITHOUT_IMEI: 'LEGACY_WITHOUT_IMEI',
    ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
    ASSET_AMBIGUOUS: 'ASSET_AMBIGUOUS',
    SOURCE_FILE_MISSING: 'SOURCE_FILE_MISSING',
    FILE_REJECTED: 'FILE_REJECTED',
    MIGRATION_FAILED: 'MIGRATION_FAILED',
});

/** Qual status cada problema produz: "não localizado" é falta de correspondência; o resto é erro. */
const ISSUE_STATUS = Object.freeze({
    [ISSUE.INVALID_NAME]: MIGRATION_STATUS.ERROR,
    [ISSUE.LEGACY_NOT_FOUND]: MIGRATION_STATUS.NOT_FOUND,
    [ISSUE.LEGACY_WITHOUT_IMEI]: MIGRATION_STATUS.NOT_FOUND,
    [ISSUE.ASSET_NOT_FOUND]: MIGRATION_STATUS.NOT_FOUND,
    [ISSUE.ASSET_AMBIGUOUS]: MIGRATION_STATUS.ERROR,
    [ISSUE.SOURCE_FILE_MISSING]: MIGRATION_STATUS.ERROR,
    [ISSUE.FILE_REJECTED]: MIGRATION_STATUS.ERROR,
    [ISSUE.MIGRATION_FAILED]: MIGRATION_STATUS.ERROR,
});

/** Status que a validação aceita reprocessar (o que não foi migrado nem ignorado). */
const VALIDATABLE_STATUSES = Object.freeze([
    MIGRATION_STATUS.PENDING, MIGRATION_STATUS.VALIDATED, MIGRATION_STATUS.ERROR, MIGRATION_STATUS.NOT_FOUND,
]);

/** Status que o "reprocessar" devolve para a fila. */
const RETRYABLE_STATUSES = Object.freeze([MIGRATION_STATUS.ERROR, MIGRATION_STATUS.NOT_FOUND]);

/** Linha presa em `processing` há mais que isso é considerada abandonada (queda no meio do lote). */
const STALE_PROCESSING_MINUTES = 15;

const RESPONSIBLE_MAX_LENGTH = 100;   // gapp_asset_term.reponsible_name
const IMEI_MAX_LENGTH = 15;           // gs_smartphone.imei1/imei2
const INT_MAX = 2147483647;

/**
 * Lê o nome do arquivo legado.
 *
 * Regra do sistema antigo: os dígitos antes do PRIMEIRO hífen são o `codigo`
 * de `gs_smartphone`; o restante (sem a extensão) é a identificação original —
 * aqui, o nome do responsável. Espaços em volta do hífen são tolerados.
 *
 * @param {string} fileName - só o nome (sem pasta).
 * @returns {{ ok: true, legacyCode: number, responsibleName: string }
 *         | { ok: false, reason: string }}
 */
function parseLegacyFileName(fileName) {
    const name = String(fileName ?? '').trim();
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;

    const hyphen = base.indexOf('-');
    if (hyphen < 0) return { ok: false, reason: 'Nome sem hífen: esperado "<código>-<nome>.<extensão>".' };

    const codePart = base.slice(0, hyphen).trim();
    if (!/^\d+$/.test(codePart)) {
        return { ok: false, reason: `O trecho antes do primeiro hífen ("${codePart}") não é um código numérico.` };
    }

    const legacyCode = Number(codePart);
    if (!Number.isSafeInteger(legacyCode) || legacyCode <= 0 || legacyCode > INT_MAX) {
        return { ok: false, reason: `Código "${codePart}" fora da faixa válida.` };
    }

    const responsibleName = base.slice(hyphen + 1).replace(/\s+/g, ' ').trim().slice(0, RESPONSIBLE_MAX_LENGTH).trim();
    if (!responsibleName) return { ok: false, reason: 'Nome do responsável vazio depois do hífen.' };

    return { ok: true, legacyCode, responsibleName };
}

/**
 * IMEI comparável: só dígitos. `null` quando não sobra nada útil
 * (vazio, "0", "000...", texto) — esses nunca podem casar com um ativo.
 *
 * @param {*} value
 * @returns {string|null}
 */
function normalizeImei(value) {
    if (value === null || value === undefined) return null;
    const digits = String(value).replace(/\D/g, '');
    if (!digits || /^0+$/.test(digits) || digits.length > IMEI_MAX_LENGTH) return null;
    return digits;
}

/**
 * IMEIs a procurar na base nova, na ordem de preferência (imei1, depois imei2).
 * Repetido (imei1 = imei2) entra uma vez só.
 *
 * @param {{ imei1?: string|null, imei2?: string|null }} legacy
 * @returns {{ imei: string, source: 'imei1'|'imei2' }[]}
 */
function legacyImeiCandidates(legacy = {}) {
    const list = [];
    const imei1 = normalizeImei(legacy.imei1);
    const imei2 = normalizeImei(legacy.imei2);
    if (imei1) list.push({ imei: imei1, source: 'imei1' });
    if (imei2 && imei2 !== imei1) list.push({ imei: imei2, source: 'imei2' });
    return list;
}

/**
 * Decide o ativo a partir dos smartphones da base nova que casaram com algum
 * IMEI do legado.
 *
 * Só há vínculo com UM ativo. Se o imei1 aponta para um aparelho e o imei2 para
 * outro (ou um IMEI aparece em dois cadastros), é ambíguo e vai para análise
 * manual — preferir o imei1 nesse caso seria adivinhar.
 *
 * @param {{ imei: string, source: string }[]} candidates - de `legacyImeiCandidates`.
 * @param {{ active_id: number, imei_1?: string, imei_2?: string }[]} smartphones
 *        - linhas da base nova cujo imei_1/imei_2 está entre os candidatos.
 * @returns {{ ok: true, activeId: number, imei: string, imeiSource: string }
 *         | { ok: false, issue: string, reason: string, activeIds?: number[] }}
 */
function resolveAssetMatch(candidates, smartphones = []) {
    if (!candidates.length) {
        return { ok: false, issue: ISSUE.LEGACY_WITHOUT_IMEI, reason: 'Smartphone do legado sem IMEI preenchido (imei1 e imei2 vazios).' };
    }

    const byImei = new Map(candidates.map(c => [c.imei, new Set()]));
    for (const phone of smartphones) {
        for (const column of ['imei_1', 'imei_2']) {
            const imei = normalizeImei(phone[column]);
            if (imei && byImei.has(imei)) byImei.get(imei).add(Number(phone.active_id));
        }
    }

    const activeIds = [...new Set([...byImei.values()].flatMap(set => [...set]))];
    const imeiList = candidates.map(c => `${c.source}=${c.imei}`).join(', ');

    if (activeIds.length === 0) {
        return { ok: false, issue: ISSUE.ASSET_NOT_FOUND, reason: `Nenhum smartphone na base atual com o IMEI do legado (${imeiList}).` };
    }
    if (activeIds.length > 1) {
        return {
            ok: false,
            issue: ISSUE.ASSET_AMBIGUOUS,
            reason: `IMEI do legado (${imeiList}) corresponde a mais de um ativo: ${activeIds.map(id => `#${id}`).join(', ')}.`,
            activeIds,
        };
    }

    // Um ativo só: registra qual IMEI casou primeiro, na ordem de preferência
    const winner = candidates.find(c => byImei.get(c.imei).size > 0);
    return { ok: true, activeId: activeIds[0], imei: winner.imei, imeiSource: winner.source };
}

/**
 * Lista de ids vinda do body: inteiros positivos, sem repetição, com teto.
 * @returns {number[]|null} `null` quando não veio lista (= "os próximos da fila").
 */
function normalizeIdList(ids, max) {
    if (ids === undefined || ids === null) return null;
    const list = (Array.isArray(ids) ? ids : [ids])
        .map(Number)
        .filter(id => Number.isSafeInteger(id) && id > 0);
    return [...new Set(list)].slice(0, max);
}

/** Tamanho de lote dentro da faixa — o padrão é pequeno de propósito (lote de teste). */
function normalizeBatchSize(value, { fallback, max }) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.min(Math.trunc(n), max);
}

/** Mensagem cabe na coluna (VARCHAR 1000). */
function clipMessage(text, max = 1000) {
    const value = String(text ?? '').trim();
    return value.length > max ? `${value.slice(0, max - 1)}…` : value || null;
}

module.exports = {
    MIGRATION_STATUS,
    ALL_STATUSES,
    ISSUE,
    ISSUE_STATUS,
    VALIDATABLE_STATUSES,
    RETRYABLE_STATUSES,
    STALE_PROCESSING_MINUTES,
    RESPONSIBLE_MAX_LENGTH,
    parseLegacyFileName,
    normalizeImei,
    legacyImeiCandidates,
    resolveAssetMatch,
    normalizeIdList,
    normalizeBatchSize,
    clipMessage,
};
