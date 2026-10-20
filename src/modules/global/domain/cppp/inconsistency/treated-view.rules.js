/**
 * @fileoverview As duas visões de marcação e como uma ocorrência sai da lista.
 *
 * Puro.
 *
 * - **Visão AFD** (fiscal): as marcações tipo 3 como o relógio gravou. É o que
 *   a fiscalização consome, e nada aqui a altera.
 * - **Visão tratada** (folha e relatórios): AFD + ajustes ativos. Batida
 *   esquecida entra, leitura desconsiderada sai, e dias cobertos por
 *   justificativa (atestado, férias...) ficam marcados.
 *
 * Uma ocorrência é **pendente** quando as regras ainda a encontram na visão
 * tratada, num dia não justificado. É **tratada** quando aparecia na visão AFD
 * e deixou de aparecer — o ajuste resolveu. Ou seja: a lista não guarda estado
 * de "resolvido"; ela é recalculada, e lançar o ajuste certo é o que tira a
 * ocorrência da lista. Ajuste errado (ex.: batida esquecida que deixa o dia
 * ainda ímpar) mantém a ocorrência pendente, que é o comportamento correto.
 *
 * @module modules/global/domain/cppp/inconsistency/treated-view.rules
 */

const { AdjustmentType, IssueStatus } = require('../cppp.enums');
const { coveredDays } = require('../adjustment/adjustment.rules');
const { findingKey } = require('./punch-inconsistency.rules');

const PunchSource = Object.freeze({ RELOGIO: 'relogio', AJUSTE: 'ajuste' });

/**
 * @typedef {object} ClockPunch
 * @property {string} cpf
 * @property {string} day
 * @property {string} time
 * @property {number} deviceId
 * @property {number} nsr
 */

/**
 * Aplica os ajustes ATIVOS às marcações do relógio.
 *
 * @param {ClockPunch[]} punches
 * @param {object[]} adjustments - normalizados (camelCase), já sem os cancelados.
 * @returns {{punches: object[], justifiedDays: Map<string, object[]>}}
 *   `justifiedDays`: `cpf|day` → ajustes que justificam aquele dia.
 */
function applyAdjustments(punches, adjustments) {
    const disregarded = new Map();
    const added = [];
    const justifiedDays = new Map();

    for (const adjustment of adjustments) {
        if (adjustment.type === AdjustmentType.DESCONSIDERAR_LEITURA) {
            disregarded.set(`${adjustment.deviceId}|${adjustment.nsr}`, adjustment);
        } else if (adjustment.type === AdjustmentType.BATIDA_ESQUECIDA) {
            added.push({
                cpf: adjustment.cpf,
                day: adjustment.punchAt.slice(0, 10),
                time: adjustment.punchAt.slice(11, 19),
                source: PunchSource.AJUSTE,
                adjustmentId: adjustment.id ?? null,
                deviceId: null,
                nsr: null,
            });
        }

        for (const day of coveredDays(adjustment)) {
            const key = `${adjustment.cpf}|${day}`;
            if (!justifiedDays.has(key)) justifiedDays.set(key, []);
            justifiedDays.get(key).push(adjustment);
        }
    }

    const kept = punches
        .filter((punch) => !disregarded.has(`${punch.deviceId}|${punch.nsr}`))
        .map((punch) => ({ ...punch, source: PunchSource.RELOGIO, adjustmentId: null }));

    return { punches: [...kept, ...added], justifiedDays };
}

/**
 * Junta as ocorrências da visão AFD e da tratada numa lista com situação.
 *
 * @param {object[]} rawFindings      - `analyse()` sobre a visão AFD.
 * @param {object[]} treatedFindings  - `analyse()` sobre a visão tratada.
 * @param {Map<string, object[]>} justifiedDays
 * @returns {object[]} ocorrências com `status` (`pendente`/`tratada`).
 */
function classifyFindings(rawFindings, treatedFindings, justifiedDays) {
    const isJustified = (finding) => justifiedDays.has(`${finding.cpf}|${finding.day}`);

    const pending = treatedFindings
        .filter((finding) => !isJustified(finding))
        .map((finding) => ({ ...finding, status: IssueStatus.PENDENTE }));

    const pendingKeys = new Set(pending.map(findingKey));

    const treated = rawFindings
        .filter((finding) => !pendingKeys.has(findingKey(finding)))
        .map((finding) => ({ ...finding, status: IssueStatus.TRATADA }));

    return [...pending, ...treated].sort((a, b) =>
        a.day.localeCompare(b.day) || a.cpf.localeCompare(b.cpf) || a.issue.localeCompare(b.issue));
}

module.exports = { PunchSource, applyAdjustments, classifyFindings };
