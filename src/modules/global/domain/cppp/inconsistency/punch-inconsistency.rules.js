/**
 * @fileoverview Detecção de marcações inconsistentes — porte do
 * `controlid_etl/audit.py`, que já rodou contra agosto/2026 inteiro.
 *
 * Puro. Trabalha só com o que o AFD oferece: não conhece jornada contratada
 * nem status do contrato. Por isso as regras comparam cada dia com os pares do
 * próprio dia e com o histórico da própria pessoa, nunca com um horário
 * esperado.
 *
 * | Regra          | Condição                                                    |
 * |----------------|-------------------------------------------------------------|
 * | `batida_unica` | um único registro no dia                                    |
 * | `batida_impar` | número ímpar de batidas (≥ 3)                               |
 * | `duplicada`    | duas leituras separadas por `duplicateWindowMinutes` ou menos |
 * | `fecha_cedo`   | dia PAR, mas a última batida `earlyCloseMinutes`+ antes da  |
 * |                | mediana de encerramento da pessoa (exige `minBaselineDays`) |
 *
 * O dia típico aqui tem SEIS batidas (entrada, café, almoço, saída) — nada
 * neste arquivo assume quatro.
 *
 * Fidelidade ao Python, inclusive no que parece estranho:
 * - minutos contados por `HH:MM`, segundos descartados (08:00:59 → 08:03:00
 *   dá 3 min, e acusa);
 * - a mediana usa TODOS os dias recebidos daquela pessoa, inclusive o próprio
 *   dia avaliado e dias ímpares. O que mudou é QUEM escolhe os dias recebidos:
 *   o caso de uso manda uma janela de histórico própria, não o período da tela
 *   (ver `analysis-window.rules`).
 *
 * @module modules/global/domain/cppp/inconsistency/punch-inconsistency.rules
 */

const { IssueType } = require('../cppp.enums');

/** Padrões do ETL. Os valores de produção vêm de `config/cppp.js`. */
const DEFAULT_PARAMS = Object.freeze({
    duplicateWindowMinutes: 3,
    earlyCloseMinutes: 90,
    minBaselineDays: 5,
});

/**
 * @typedef {object} Punch
 * @property {string} cpf
 * @property {string} day  - `YYYY-MM-DD`
 * @property {string} time - `HH:MM:SS`
 */

/**
 * @typedef {object} Finding
 * @property {string}   cpf
 * @property {string}   day
 * @property {number}   punchCount
 * @property {string[]} times   - `HH:MM`, em ordem.
 * @property {string}   issue   - um de `IssueType`.
 * @property {string}   detail  - frase pronta para a tela, igual à do ETL.
 * @property {object}   context - o que justifica o apontamento.
 */

function toMinutes(time) {
    const [hour, minute] = String(time).split(':');
    return Number(hour) * 60 + Number(minute);
}

function clock(minutes) {
    const total = Math.round(minutes);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Mesma mediana do `statistics.median`: média dos dois do meio quando par. */
function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Agrupa por pessoa e dia, horários em ordem.
 *
 * @param {Punch[]} punches
 * @returns {Map<string, {cpf: string, day: string, times: string[]}>} chave `cpf|day`.
 */
function groupByDay(punches) {
    const byDay = new Map();
    for (const { cpf, day, time } of punches) {
        const key = `${cpf}|${day}`;
        if (!byDay.has(key)) byDay.set(key, { cpf, day, times: [] });
        byDay.get(key).times.push(time);
    }
    for (const entry of byDay.values()) entry.times.sort();
    return byDay;
}

/**
 * Mediana do horário de encerramento por pessoa.
 *
 * @param {Map} byDay - saída de `groupByDay`.
 * @returns {Map<string, {medianMinutes: number, days: number}>}
 */
function closingBaselines(byDay) {
    const closings = new Map();
    for (const { cpf, times } of byDay.values()) {
        if (!closings.has(cpf)) closings.set(cpf, []);
        closings.get(cpf).push(toMinutes(times[times.length - 1]));
    }

    const baselines = new Map();
    for (const [cpf, values] of closings) {
        baselines.set(cpf, { medianMinutes: median(values), days: values.length });
    }
    return baselines;
}

/**
 * Recebe marcações e devolve as inconsistências, em ordem de pessoa e dia.
 *
 * @param {Punch[]} punches
 * @param {Partial<typeof DEFAULT_PARAMS>} [params]
 * @returns {Finding[]}
 */
function analyse(punches, params = {}) {
    const { duplicateWindowMinutes, earlyCloseMinutes, minBaselineDays } = { ...DEFAULT_PARAMS, ...params };

    const byDay = groupByDay(punches);
    const baselines = closingBaselines(byDay);
    const findings = [];

    const ordered = [...byDay.values()].sort((a, b) =>
        a.cpf === b.cpf ? a.day.localeCompare(b.day) : a.cpf.localeCompare(b.cpf));

    for (const { cpf, day, times } of ordered) {
        const count = times.length;
        const shown = times.map((time) => time.slice(0, 5));

        const record = (issue, detail, context = {}) => {
            findings.push({ cpf, day, punchCount: count, times: shown, issue, detail, context });
        };

        if (count === 1) {
            record(IssueType.BATIDA_UNICA, 'único registro no dia');
        } else if (count % 2) {
            record(IssueType.BATIDA_IMPAR, `${count} batidas, falta uma para fechar os pares`);
        }

        for (let i = 1; i < count; i++) {
            const earlier = times[i - 1];
            const later = times[i];
            const gap = toMinutes(later) - toMinutes(earlier);
            if (gap <= duplicateWindowMinutes) {
                record(
                    IssueType.DUPLICADA,
                    `${earlier.slice(0, 5)} e ${later.slice(0, 5)} com ${gap} min de diferença`,
                    { first: earlier.slice(0, 5), second: later.slice(0, 5), gap_minutes: gap },
                );
            }
        }

        // Paridade par não garante dia fechado: quem sai para o almoço e não
        // volta deixa um número par de batidas e nenhuma saída registrada.
        const baseline = baselines.get(cpf);
        if (count % 2 === 0 && baseline.days >= minBaselineDays) {
            const closed = toMinutes(times[count - 1]);
            if (baseline.medianMinutes - closed >= earlyCloseMinutes) {
                record(
                    IssueType.FECHA_CEDO,
                    `última batida ${times[count - 1].slice(0, 5)}, mediana da pessoa ${clock(baseline.medianMinutes)}`,
                    {
                        last_punch: times[count - 1].slice(0, 5),
                        median_closing: clock(baseline.medianMinutes),
                        baseline_days: baseline.days,
                        early_by_minutes: Math.round(baseline.medianMinutes - closed),
                    },
                );
            }
        }
    }

    return findings;
}

/**
 * Chave que identifica UMA ocorrência entre a visão bruta e a tratada.
 *
 * Para `duplicada` o par de horários entra na chave: um dia pode ter dois
 * pares duplicados, e desconsiderar uma leitura resolve só um deles.
 *
 * @param {Finding} finding
 * @returns {string}
 */
function findingKey(finding) {
    const pair = finding.issue === IssueType.DUPLICADA
        ? `|${finding.context.first}-${finding.context.second}`
        : '';
    return `${finding.cpf}|${finding.day}|${finding.issue}${pair}`;
}

/**
 * Contagem por regra — o `summarise` do ETL.
 *
 * @param {Array<{issue: string}>} findings
 * @returns {Object<string, number>}
 */
function summarise(findings) {
    const counts = {};
    for (const { issue } of findings) counts[issue] = (counts[issue] ?? 0) + 1;
    return counts;
}

module.exports = { DEFAULT_PARAMS, analyse, summarise, findingKey, groupByDay, closingBaselines, clock };
