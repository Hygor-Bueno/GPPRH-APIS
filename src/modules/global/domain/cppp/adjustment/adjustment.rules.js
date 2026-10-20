/**
 * @fileoverview Forma de cada tipo de ajuste e o que ele cobre.
 *
 * Puro; lança `AppError` 400 em entrada inválida. É a camada onde mora a
 * correção: a marcação original em `cppp_afd_records` nunca muda, e cada
 * ajuste é um registro novo ao lado dela, com motivo e autor.
 *
 * | Tipo                    | Forma               | Efeito na visão tratada              |
 * |-------------------------|---------------------|--------------------------------------|
 * | `batida_esquecida`      | `punch_at`          | acrescenta uma batida                |
 * | `desconsiderar_leitura` | `device_id` + `nsr` | tira aquela leitura (não a apaga)    |
 * | `declaracao_horas`      | intervalo no dia    | justifica o dia                      |
 * | `atestado`, `abono`     | período OU intervalo| justifica o(s) dia(s)                |
 * | `ferias`, `folga`,      | período             | justifica cada dia do período        |
 * | `falta_justificada`     |                     |                                      |
 *
 * "Justificar o dia" = toda ocorrência daquele dia sai da lista de pendentes.
 * Não há tentativa de conferir se o atestado de 2h "cobre" a batida que falta:
 * isso exige jornada contratada, que ainda não existe (decisão de 08/10/2026).
 *
 * @module modules/global/domain/cppp/adjustment/adjustment.rules
 */

const { AppError } = require('../../../../../errors/app.error');
const { AdjustmentType } = require('../cppp.enums');
const { isDate, spanDays, eachDay } = require('../date.rules');
const { isUsableIdentifier } = require('../cpf.rules');

const Shape = Object.freeze({
    PUNCH: 'punch',
    READING: 'reading',
    TIME_RANGE: 'time_range',
    PERIOD: 'period',
    PERIOD_OR_TIME_RANGE: 'period_or_time_range',
});

const SHAPE_BY_TYPE = Object.freeze({
    [AdjustmentType.BATIDA_ESQUECIDA]: Shape.PUNCH,
    [AdjustmentType.DESCONSIDERAR_LEITURA]: Shape.READING,
    [AdjustmentType.DECLARACAO_HORAS]: Shape.TIME_RANGE,
    [AdjustmentType.ATESTADO]: Shape.PERIOD_OR_TIME_RANGE,
    [AdjustmentType.ABONO]: Shape.PERIOD_OR_TIME_RANGE,
    [AdjustmentType.FERIAS]: Shape.PERIOD,
    [AdjustmentType.FOLGA]: Shape.PERIOD,
    [AdjustmentType.FALTA_JUSTIFICADA]: Shape.PERIOD,
});

/** Tipos que justificam o dia inteiro em vez de mexer nas batidas. */
const JUSTIFICATION_TYPES = Object.freeze([
    AdjustmentType.DECLARACAO_HORAS,
    AdjustmentType.ATESTADO,
    AdjustmentType.ABONO,
    AdjustmentType.FERIAS,
    AdjustmentType.FOLGA,
    AdjustmentType.FALTA_JUSTIFICADA,
]);

const REASON_MIN = 3;
const REASON_MAX = 500;

/** `2026-08-20T08:03`, `2026-08-20 08:03:00` → `2026-08-20 08:03:00`; inválido → `null`. */
function normalizeDateTime(value) {
    const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? '').trim());
    if (!match) return null;
    const [, date, hour, minute, second = '00'] = match;
    if (!isDate(date) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
    return `${date} ${hour}:${minute}:${second}`;
}

const isBlank = (value) => value === undefined || value === null || value === '';

function fail(message) {
    throw new AppError(message, 400, { code: 'CPPP_ADJUSTMENT_INVALID' });
}

/** Recusa campos que não pertencem à forma do tipo — ambiguidade vira 400. */
function rejectExtra(input, allowed, type) {
    const shaped = ['punch_at', 'device_id', 'nsr', 'starts_at', 'ends_at', 'period_start', 'period_end'];
    const extra = shaped.filter((field) => !allowed.includes(field) && !isBlank(input[field]));
    if (extra.length) fail(`O tipo '${type}' não usa: ${extra.join(', ')}.`);
}

function readTimeRange(input) {
    const startsAt = normalizeDateTime(input.starts_at);
    const endsAt = normalizeDateTime(input.ends_at);
    if (!startsAt || !endsAt) fail("Informe 'starts_at' e 'ends_at' (data e hora).");
    if (startsAt.slice(0, 10) !== endsAt.slice(0, 10)) fail('O intervalo precisa começar e terminar no mesmo dia.');
    if (endsAt <= startsAt) fail("'ends_at' precisa ser depois de 'starts_at'.");
    return { startsAt, endsAt, workDate: startsAt.slice(0, 10) };
}

function readPeriod(input, maxPeriodDays) {
    const periodStart = input.period_start;
    const periodEnd = input.period_end;
    if (!isDate(periodStart) || !isDate(periodEnd)) fail("Informe 'period_start' e 'period_end' (AAAA-MM-DD).");
    if (periodEnd < periodStart) fail("'period_end' não pode ser antes de 'period_start'.");
    if (spanDays(periodStart, periodEnd) > maxPeriodDays) fail(`O período não pode passar de ${maxPeriodDays} dias.`);
    return { periodStart, periodEnd };
}

/**
 * Valida e normaliza a entrada de um ajuste.
 *
 * NÃO confere existência da leitura apontada em `desconsiderar_leitura` — isso
 * exige banco, e guarda com banco mora no caso de uso.
 *
 * @param {object} input             - corpo da requisição (snake_case).
 * @param {object} options
 * @param {string} options.today     - `YYYY-MM-DD`.
 * @param {number} options.maxPeriodDays
 * @returns {object} ajuste normalizado (camelCase), pronto para o repositório.
 */
function normalizeAdjustment(input, { today, maxPeriodDays }) {
    const type = input.type;
    const shape = SHAPE_BY_TYPE[type];
    if (!shape) fail(`Tipo de ajuste desconhecido: '${type}'.`);

    const cpf = String(input.cpf ?? '').replace(/\D/g, '');
    if (!isUsableIdentifier(cpf)) fail('Identificador inválido — ajuste só pode ser lançado para CPF ou PIS que passa no dígito verificador.');

    const reason = String(input.reason ?? '').trim();
    if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
        fail(`O motivo é obrigatório e deve ter entre ${REASON_MIN} e ${REASON_MAX} caracteres.`);
    }

    if (!isBlank(input.work_date) && !isDate(input.work_date)) fail("'work_date' deve estar no formato AAAA-MM-DD.");

    const result = {
        type, cpf, reason,
        workDate: null, punchAt: null, deviceId: null, nsr: null,
        startsAt: null, endsAt: null, periodStart: null, periodEnd: null,
    };

    if (shape === Shape.PUNCH) {
        rejectExtra(input, ['punch_at'], type);
        result.punchAt = normalizeDateTime(input.punch_at);
        if (!result.punchAt) fail("Informe 'punch_at' (data e hora da batida esquecida).");
        result.workDate = result.punchAt.slice(0, 10);
    } else if (shape === Shape.READING) {
        rejectExtra(input, ['device_id', 'nsr'], type);
        result.deviceId = Number(input.device_id);
        result.nsr = Number(input.nsr);
        if (!Number.isInteger(result.deviceId) || result.deviceId < 1 || !Number.isInteger(result.nsr) || result.nsr < 1) {
            fail("Informe 'device_id' e 'nsr' da leitura a desconsiderar.");
        }
        if (!isDate(input.work_date)) fail("Informe 'work_date' — o dia da leitura.");
        result.workDate = input.work_date;
    } else if (shape === Shape.TIME_RANGE) {
        rejectExtra(input, ['starts_at', 'ends_at'], type);
        Object.assign(result, readTimeRange(input));
    } else if (shape === Shape.PERIOD) {
        rejectExtra(input, ['period_start', 'period_end'], type);
        Object.assign(result, readPeriod(input, maxPeriodDays));
        result.workDate = isBlank(input.work_date) ? result.periodStart : input.work_date;
    } else {
        const hasRange = !isBlank(input.starts_at) || !isBlank(input.ends_at);
        const hasPeriod = !isBlank(input.period_start) || !isBlank(input.period_end);
        if (hasRange === hasPeriod) {
            fail(`O tipo '${type}' aceita período ('period_start'/'period_end') OU intervalo no dia ('starts_at'/'ends_at') — um dos dois.`);
        }
        if (hasRange) {
            rejectExtra(input, ['starts_at', 'ends_at'], type);
            Object.assign(result, readTimeRange(input));
        } else {
            rejectExtra(input, ['period_start', 'period_end'], type);
            Object.assign(result, readPeriod(input, maxPeriodDays));
            result.workDate = isBlank(input.work_date) ? result.periodStart : input.work_date;
        }
    }

    if (result.periodStart) {
        // O ajuste de período nasce de uma ocorrência: o dia dela precisa estar
        // dentro do período, senão a ocorrência não sairia da lista.
        if (result.workDate < result.periodStart || result.workDate > result.periodEnd) {
            fail("'work_date' precisa estar dentro do período informado.");
        }
    } else if (!isBlank(input.work_date) && input.work_date !== result.workDate) {
        fail("'work_date' não corresponde à data do ajuste.");
    }

    // Férias e folga podem ser lançadas adiantadas; o resto corrige o que já
    // aconteceu. Batida "esquecida" amanhã é erro de digitação.
    if (!result.periodStart && result.workDate > today) fail('Não é possível lançar ajuste para dia futuro.');

    return result;
}

/**
 * Dias que um ajuste justifica (vazio para os que mexem em batida).
 *
 * @param {{type: string, workDate: string, periodStart?: string|null, periodEnd?: string|null}} adjustment
 * @returns {string[]}
 */
function coveredDays(adjustment) {
    if (!JUSTIFICATION_TYPES.includes(adjustment.type)) return [];
    if (adjustment.periodStart && adjustment.periodEnd) return eachDay(adjustment.periodStart, adjustment.periodEnd);
    return [adjustment.workDate];
}

module.exports = {
    Shape,
    SHAPE_BY_TYPE,
    JUSTIFICATION_TYPES,
    normalizeAdjustment,
    normalizeDateTime,
    coveredDays,
};
