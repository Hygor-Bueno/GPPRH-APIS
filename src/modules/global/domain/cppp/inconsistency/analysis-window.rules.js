/**
 * @fileoverview Que dias a tela pode analisar, e que histórico a regra
 * `fecha_cedo` precisa ler.
 *
 * Puro; lança `AppError` 400 em período inválido.
 *
 * ─── O dia da coleta nunca aparece ───────────────────────────────────────────
 * Se o período inclui o dia em que a coleta rodou, todo mundo que ainda estava
 * trabalhando vira inconsistente — em agosto isso inflou o relatório em 88 de
 * 515 ocorrências (17% de falso positivo puro). O corte é o MENOR entre:
 *
 *   - ontem (o dia corrente nunca é completo), e
 *   - a véspera da última coleta bem-sucedida — com coleta diária às 02:00, o
 *     dia anterior só está inteiro depois dela. Se a coleta falhar por três
 *     dias, o corte fica três dias para trás em vez de mostrar dias pela metade.
 *
 * ─── Histórico do `fecha_cedo` ───────────────────────────────────────────────
 * No ETL a mediana era calculada sobre o período pedido (o mês inteiro). Na
 * tela, filtrar uma semana deixaria menos de 5 dias de base e a regra pararia
 * de acusar — o resultado mudaria conforme o filtro. Aqui a leitura começa em
 * `baselineDays` antes do fim do período, ou no início do período se ele for
 * maior.
 *
 * @module modules/global/domain/cppp/inconsistency/analysis-window.rules
 */

const { AppError } = require('../../../../../errors/app.error');
const { isDate, addDays, spanDays, minDate } = require('../date.rules');

/**
 * Último dia inteiramente coberto por coleta.
 *
 * @param {Array<string|null>} lastSuccessAts - `YYYY-MM-DDTHH:MM:SS` local da
 *        última coleta bem-sucedida de cada relógio ATIVO; `null` = nunca.
 * @returns {string|null} `null` quando nenhum relógio foi coletado ainda.
 */
function coverageUntil(lastSuccessAts) {
    const covered = lastSuccessAts
        .filter(Boolean)
        .map((at) => addDays(at.slice(0, 10), -1));
    // O MENOR: quem bate nos dois relógios só tem o dia completo quando os dois
    // foram coletados.
    return covered.length ? minDate(...covered) : null;
}

/**
 * @param {object} input
 * @param {string} [input.from]            - pedido pela tela.
 * @param {string} [input.to]
 * @param {string}  input.today            - `YYYY-MM-DD`.
 * @param {string|null} input.coverage     - saída de `coverageUntil`.
 * @param {number}  input.baselineDays
 * @param {number}  input.maxPeriodDays
 * @param {number} [input.defaultPeriodDays=30]
 * @returns {{from: string|null, to: string|null, fetchFrom: string|null,
 *            cutoff: string|null, empty: boolean}}
 */
function resolveWindow({ from, to, today, coverage, baselineDays, maxPeriodDays, defaultPeriodDays = 30 }) {
    if (from && !isDate(from)) throw new AppError("'from' deve estar no formato AAAA-MM-DD.", 400);
    if (to && !isDate(to)) throw new AppError("'to' deve estar no formato AAAA-MM-DD.", 400);
    if (from && to && from > to) throw new AppError("'from' não pode ser depois de 'to'.", 400);

    const cutoff = minDate(addDays(today, -1), coverage);
    if (!coverage) return { from: from ?? null, to: to ?? null, fetchFrom: null, cutoff: null, empty: true };

    const effectiveTo = minDate(to ?? cutoff, cutoff);
    const effectiveFrom = from ?? addDays(effectiveTo, -(defaultPeriodDays - 1));

    if (effectiveFrom > effectiveTo) {
        return { from: effectiveFrom, to: effectiveTo, fetchFrom: null, cutoff, empty: true };
    }

    if (spanDays(effectiveFrom, effectiveTo) > maxPeriodDays) {
        throw new AppError(`O período não pode passar de ${maxPeriodDays} dias.`, 400);
    }

    return {
        from: effectiveFrom,
        to: effectiveTo,
        fetchFrom: minDate(effectiveFrom, addDays(effectiveTo, -(baselineDays - 1))),
        cutoff,
        empty: false,
    };
}

module.exports = { coverageUntil, resolveWindow };
