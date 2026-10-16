/**
 * @fileoverview Quando a coleta automática roda e o que ela pede ao relógio.
 *
 * Puro.
 *
 * ─── Uma vez por dia, referente ao dia anterior ──────────────────────────────
 * Decisão de 08/10/2026. A coleta roda uma vez por dia no horário
 * `CPPP_COLLECT_TIME` (padrão 02:00) e traz o dia anterior inteiro — mas NÃO
 * pedindo "o dia anterior" ao relógio: o filtro de data do equipamento é
 * aproximado (pedindo 01/08 ele devolveu desde 31/07). O pedido é sempre
 * incremental por NSR, que não perde nada: traz o dia anterior completo e
 * qualquer coisa que tenha ficado para trás numa coleta que falhou.
 *
 * Se o worker estava parado no horário, a coleta do dia roda assim que ele
 * voltar (recuperação), e não espera o dia seguinte.
 *
 * @module modules/global/domain/cppp/collect/collect-schedule.rules
 */

const { localDate, localDateTime } = require('../date.rules');

const COLLECT_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * @param {object} input
 * @param {Date}   input.now
 * @param {string} input.collectTime     - `HH:MM`.
 * @param {string|null} input.lastScheduledAt - `YYYY-MM-DDTHH:MM:SS` local da
 *        última coleta AGENDADA criada para o relógio (qualquer status).
 * @returns {boolean}
 */
function isScheduleDue({ now, collectTime, lastScheduledAt }) {
    if (!COLLECT_TIME_RE.test(collectTime)) {
        throw new Error(`CPPP_COLLECT_TIME inválido: '${collectTime}' (use HH:MM).`);
    }

    const slot = `${localDate(now)}T${collectTime}:00`;
    if (localDateTime(now) < slot) return false;
    return !lastScheduledAt || lastScheduledAt < slot;
}

/**
 * O que pedir ao relógio.
 *
 * Recomeça do fim do primeiro bloco contínuo de NSR, e não do maior NSR
 * gravado: se algum registro ficou de fora (buraco), a próxima coleta o pede
 * de novo, e a idempotência absorve o que vier repetido.
 *
 * @param {number|null} lastContiguousNsr - fim do primeiro bloco contínuo;
 *        `null` quando não há nada gravado para o relógio.
 * @returns {{initialNsr: number|null, requestedFrom: string}}
 */
function resolveCollectRequest(lastContiguousNsr) {
    if (lastContiguousNsr === null || lastContiguousNsr === undefined) {
        // Primeira coleta: AFD integral. Com o relógio atual são ~44 mil linhas
        // e o equipamento é lento para gerá-las — daí o timeout de 180s.
        return { initialNsr: null, requestedFrom: 'full' };
    }
    const initialNsr = Number(lastContiguousNsr) + 1;
    return { initialNsr, requestedFrom: `nsr:${initialNsr}` };
}

module.exports = { isScheduleDue, resolveCollectRequest, COLLECT_TIME_RE };
