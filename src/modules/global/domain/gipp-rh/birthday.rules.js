/**
 * @fileoverview Regras puras da lista de aniversariantes do mês (GIPP-RH).
 *
 * O cartaz segue o modelo do RH ("Tem gente fazendo aniversário!"): um slide
 * por filial, colaboradores em ordem de dia, colunas NOME | SETOR | DATA. O
 * fundo do modelo tem 19 linhas pautadas — filial com mais gente que isso
 * continua em outro slide da mesma filial.
 *
 * Nada aqui faz I/O: entra a linha crua do Protheus, sai o que vai impresso.
 *
 * Lista de exclusão: quem o RH tira do cartaz (pediu para não aparecer, por
 * exemplo) fica em `rh_birthday_exclusions` (MySQL `global`), pelo CPF — e não
 * pela matrícula, que muda numa transferência de filial e traria a pessoa de
 * volta. `withoutExcluded` tira essas pessoas antes de montar a lista, então
 * lista e cartaz batem.
 *
 * @module modules/global/domain/gipp-rh/birthday.rules
 */

const { AppError } = require('../../../../errors/app.error');

/** Linhas pautadas no fundo do cartaz (`templates/birthday-flyer/background.png`). */
const ROWS_PER_SLIDE = 19;

const MONTH_NAMES = Object.freeze([
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]);

/** `code` de todo `AppError` da lista de aniversariantes. */
const BirthdayErrorCode = Object.freeze({
    InvalidMonth: 'GIPPRH_BIRTHDAY_INVALID_MONTH',
    InvalidBranch: 'GIPPRH_BIRTHDAY_INVALID_BRANCH',
    NoBirthdays: 'GIPPRH_BIRTHDAY_NOT_FOUND',
    InvalidEmployee: 'GIPPRH_BIRTHDAY_INVALID_EMPLOYEE',
    InvalidReason: 'GIPPRH_BIRTHDAY_INVALID_REASON',
    EmployeeNotFound: 'GIPPRH_BIRTHDAY_EMPLOYEE_NOT_FOUND',
    AlreadyExcluded: 'GIPPRH_BIRTHDAY_ALREADY_EXCLUDED',
    InvalidExclusionId: 'GIPPRH_BIRTHDAY_INVALID_EXCLUSION_ID',
    ExclusionNotFound: 'GIPPRH_BIRTHDAY_EXCLUSION_NOT_FOUND',
    MysqlError: 'GIPPRH_BIRTHDAY_MYSQL_ERROR',
});

/** Tamanho de `rh_birthday_exclusions.reason`. */
const EXCLUSION_REASON_MAX_LENGTH = 255;

/**
 * Nome do centro de custo como ele deve aparecer no cartaz.
 *
 * O Protheus tem poucos CCs (≈25) e alguns vêm abreviados ou com anotação
 * interna — "FRENTE DE CX/TESOURARIA E CPD (IFOOD-CX)" não cabe na coluna e
 * não é como a loja chama o setor. O que não está aqui sai do próprio nome,
 * sem o trecho entre parênteses.
 */
const SECTOR_LABELS = Object.freeze({
    'FRENTE DE CX/TESOURARIA E CPD': 'Frente de Caixa',
    'PREVENÇÃO/ ESTOQUE': 'Prevenção/Estoque',
    'PERECIVEIS': 'Perecíveis',
    'E-COMMERCE': 'iFood',
    'ADM': 'Administração',
    'CONT/FISCAL': 'Contábil/Fiscal',
    'MKT': 'Marketing',
    'TI': 'TI',
    'RH': 'RH',
    'GERAL - AGUARDAR CADASTRO': 'Geral',
    'PRODUÇÃO/OPERAÇÃO': 'Produção',
});

/** Partículas que ficam minúsculas no meio do nome ("Maria da Silva"). */
const LOWERCASE_WORDS = new Set(['da', 'das', 'de', 'do', 'dos', 'e', 'del', 'di', 'du', 'van', 'von']);

/** Prefixo da razão que se repete em todas as lojas — no cartaz basta o bairro. */
const BRANCH_PREFIX = /^PEG PESE\s+/i;

/**
 * @param {unknown} raw - mês de referência, 1 a 12 (`"10"` ou `10`).
 * @returns {number}
 */
function normalizeMonth(raw) {
    const text = String(raw ?? '').trim();
    const month = /^\d{1,2}$/.test(text) ? Number(text) : NaN;
    if (!(month >= 1 && month <= 12)) {
        throw new AppError('Informe o mês de referência (1 a 12).', 400, {
            code: BirthdayErrorCode.InvalidMonth,
        });
    }
    return month;
}

/**
 * Filtro opcional de filiais. Aceita `"0202,0206"` ou array. Filial é VARCHAR
 * com zero à esquerda — nunca vira número.
 *
 * @param {unknown} raw
 * @returns {string[]} vazio = todas as filiais.
 */
function normalizeBranchCodes(raw) {
    if (raw === undefined || raw === null || raw === '') return [];
    const list = (Array.isArray(raw) ? raw : String(raw).split(','))
        .map(code => String(code).trim())
        .filter(Boolean);
    const invalid = list.find(code => !/^\d{4}$/.test(code));
    if (invalid) {
        throw new AppError(`Filial inválida: '${invalid}'. Use o código de 4 dígitos (ex.: 0202).`, 400, {
            code: BirthdayErrorCode.InvalidBranch,
        });
    }
    return [...new Set(list)];
}

/** @param {number} month @returns {string} "outubro" */
function monthName(month) {
    return MONTH_NAMES[month - 1];
}

/**
 * "MARIA JOSE DA SILVA" → "Maria Jose da Silva". A primeira palavra sempre
 * maiúscula, mesmo que seja partícula.
 *
 * @param {?string} text
 * @returns {string}
 */
function toTitleCase(text) {
    return String(text ?? '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .map((word, index) => {
            if (index > 0 && LOWERCASE_WORDS.has(word)) return word;
            return word.replace(/(^|[-'])(\p{L})/gu, (_, sep, letter) => sep + letter.toUpperCase());
        })
        .join(' ');
}

/**
 * @param {?string} costCenter - `CTT_DESC01` cru.
 * @returns {string}
 */
function sectorLabel(costCenter) {
    const withoutNote = String(costCenter ?? '').replace(/\(.*?\)/g, '').trim().toUpperCase();
    if (!withoutNote) return '';
    return SECTOR_LABELS[withoutNote] ?? toTitleCase(withoutNote);
}

/**
 * @param {?string} branchName - `M0_FILIAL` ("PEG PESE INTERLAGOS").
 * @param {string} branchCode
 * @returns {string} "INTERLAGOS"
 */
function branchLabel(branchName, branchCode) {
    const name = String(branchName ?? '').trim().replace(BRANCH_PREFIX, '');
    return (name || `FILIAL ${branchCode}`).toUpperCase();
}

/**
 * Linha crua do repositório → linha do cartaz.
 *
 * `registration` vai junto para a tela poder tirar a pessoa do cartaz
 * (`POST /gipp-rh/birthdays/exclusions`); o renderer não imprime.
 *
 * @param {{ branch_code: string, branch_name: ?string, registration: string, name: ?string,
 *           full_name: ?string, birth_date: string, cost_center: ?string }} row
 *        `birth_date` no formato do Protheus, `YYYYMMDD`.
 * @returns {{ branchCode: string, branchName: string, registration: string, name: string,
 *             sector: string, day: number, month: number, date: string }}
 */
function toBirthdayEntry(row) {
    const raw = String(row.birth_date ?? '').trim();
    const month = Number(raw.slice(4, 6));
    const day = Number(raw.slice(6, 8));
    return {
        branchCode: String(row.branch_code).trim(),
        branchName: branchLabel(row.branch_name, String(row.branch_code).trim()),
        registration: String(row.registration ?? '').trim(),
        name: toTitleCase(row.full_name || row.name),
        sector: sectorLabel(row.cost_center),
        day,
        month,
        date: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`,
    };
}

/**
 * Agrupa por filial (em ordem de código) e ordena cada filial por dia e nome.
 *
 * @param {ReturnType<typeof toBirthdayEntry>[]} entries
 * @returns {{ branchCode: string, branchName: string, people: object[] }[]}
 */
function groupByBranch(entries) {
    const groups = new Map();
    for (const entry of entries) {
        if (!groups.has(entry.branchCode)) {
            groups.set(entry.branchCode, { branchCode: entry.branchCode, branchName: entry.branchName, people: [] });
        }
        groups.get(entry.branchCode).people.push(entry);
    }
    const byDayThenName = (a, b) => (a.day - b.day) || a.name.localeCompare(b.name, 'pt-BR');
    return [...groups.values()]
        .sort((a, b) => a.branchCode.localeCompare(b.branchCode))
        .map(group => ({ ...group, people: group.people.sort(byDayThenName) }));
}

/**
 * Quebra cada filial em slides de `ROWS_PER_SLIDE` linhas.
 *
 * @param {{ branchCode: string, branchName: string, people: object[] }[]} groups
 * @param {number} [rowsPerSlide]
 * @returns {{ branchCode: string, branchName: string, page: number, pages: number, people: object[] }[]}
 */
function paginate(groups, rowsPerSlide = ROWS_PER_SLIDE) {
    const slides = [];
    for (const group of groups) {
        const pages = Math.max(1, Math.ceil(group.people.length / rowsPerSlide));
        for (let page = 0; page < pages; page++) {
            slides.push({
                branchCode: group.branchCode,
                branchName: group.branchName,
                page: page + 1,
                pages,
                people: group.people.slice(page * rowsPerSlide, (page + 1) * rowsPerSlide),
            });
        }
    }
    return slides;
}

/**
 * Corpo de `POST /gipp-rh/birthdays/exclusions`. A tela manda a filial e a
 * matrícula que vieram na lista do mês; o CPF é resolvido no Protheus, nunca
 * aceito do cliente.
 *
 * @param {{ branch_code?: unknown, registration?: unknown, reason?: unknown }} body
 * @returns {{ branchCode: string, registration: string, reason: ?string }}
 */
function normalizeExclusionInput(body = {}) {
    const branchCode = String(body.branch_code ?? '').trim();
    const rawRegistration = String(body.registration ?? '').trim();
    if (!/^\d{4}$/.test(branchCode) || !/^\d{1,6}$/.test(rawRegistration)) {
        throw new AppError('Informe a filial (4 dígitos) e a matrícula do colaborador.', 400, {
            code: BirthdayErrorCode.InvalidEmployee,
        });
    }
    const reason = body.reason === undefined || body.reason === null ? '' : String(body.reason).trim();
    if (reason.length > EXCLUSION_REASON_MAX_LENGTH) {
        throw new AppError(`O motivo pode ter até ${EXCLUSION_REASON_MAX_LENGTH} caracteres.`, 400, {
            code: BirthdayErrorCode.InvalidReason,
        });
    }
    return {
        branchCode,
        registration: rawRegistration.padStart(6, '0'),
        reason: reason || null,
    };
}

/**
 * @param {unknown} raw - `:id` da rota.
 * @returns {number}
 */
function normalizeExclusionId(raw) {
    const text = String(raw ?? '').trim();
    const id = /^\d+$/.test(text) ? Number(text) : NaN;
    if (!(id > 0 && Number.isSafeInteger(id))) {
        throw new AppError('Identificador de exclusão inválido.', 400, {
            code: BirthdayErrorCode.InvalidExclusionId,
        });
    }
    return id;
}

/**
 * Tira da linha crua do mês quem está na lista de exclusão.
 *
 * @template {{ cpf?: ?string }} T
 * @param {T[]} rows
 * @param {Iterable<string>} excludedCpfs
 * @returns {T[]}
 */
function withoutExcluded(rows, excludedCpfs) {
    const excluded = new Set([...excludedCpfs].map(cpf => String(cpf).trim()));
    if (!excluded.size) return rows;
    return rows.filter(row => !excluded.has(String(row.cpf ?? '').trim()));
}

/**
 * Exclusão (MySQL) + contrato atual (Protheus) → resposta. Nada da pessoa é
 * copiado para a tabela de exclusão, e o CPF fica de fora da resposta. Sem
 * contrato, filial/matrícula/nome saem nulos.
 *
 * @param {{ id: number, reason: ?string, created_at: Date, created_by: number }} exclusion
 * @param {?{ branch_code: string, branch_name: ?string, registration: string,
 *            full_name: ?string, cost_center: ?string, dismissed: boolean|number }} contract
 */
function toExclusionEntry(exclusion, contract) {
    const branchCode = contract?.branch_code ? String(contract.branch_code).trim() : null;
    return {
        id: exclusion.id,
        branchCode,
        branchName: branchCode ? branchLabel(contract.branch_name, branchCode) : null,
        registration: contract?.registration ? String(contract.registration).trim() : null,
        name: contract?.full_name ? toTitleCase(contract.full_name) : null,
        sector: sectorLabel(contract?.cost_center),
        dismissed: Boolean(contract?.dismissed),
        reason: exclusion.reason ?? null,
        createdAt: exclusion.created_at,
        createdBy: exclusion.created_by,
    };
}

module.exports = {
    ROWS_PER_SLIDE,
    EXCLUSION_REASON_MAX_LENGTH,
    BirthdayErrorCode,
    normalizeMonth,
    normalizeBranchCodes,
    monthName,
    toTitleCase,
    sectorLabel,
    branchLabel,
    toBirthdayEntry,
    groupByBranch,
    paginate,
    normalizeExclusionInput,
    normalizeExclusionId,
    withoutExcluded,
    toExclusionEntry,
};
