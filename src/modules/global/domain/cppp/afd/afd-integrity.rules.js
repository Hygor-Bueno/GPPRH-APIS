/**
 * @fileoverview Conferências que transformam "sem perder registro" em algo
 * verificado a cada coleta, em vez de presumido.
 *
 * Puro. Três verificações, de força diferente:
 *
 * 1. **Continuidade do NSR** — a defesa principal. O NSR é estritamente
 *    sequencial entre TODOS os tipos de registro (conferido no AFD integral de
 *    08/10/2026: 1 a 44.661 sem nenhum buraco). Buraco = registro que não
 *    entrou. Coleta com buraco termina `failed`, e a incremental seguinte
 *    recomeça do início do buraco (ver `lastContiguousNsr` no repositório).
 *
 * 2. **Divergência de conteúdo** — NSR já gravado que volta com outra linha. O
 *    espelho não é alterado (nunca é), e a coleta termina `failed` para que
 *    alguém olhe: no REP-C isso não deveria ser possível.
 *
 * 3. **Trailer tipo 9** — contagem por tipo declarada pelo próprio relógio. No
 *    AFD integral bate exatamente. Ainda NÃO se sabe se, numa resposta
 *    incremental (`initial_nsr`), o trailer conta só a resposta ou a memória
 *    inteira — por isso divergência aqui vira AVISO, não falha. Endurecer
 *    depois de observar algumas coletas incrementais reais.
 *
 * @module modules/global/domain/cppp/afd/afd-integrity.rules
 */

const { TrailerCheck } = require('../cppp.enums');

/**
 * Faixas de NSR ausentes.
 *
 * @param {number[]}    nsrs          - NSRs recebidos (qualquer ordem).
 * @param {number|null} expectedFirst - NSR que deveria abrir a resposta
 *                                      (`initial_nsr` pedido); `null` quando
 *                                      não há expectativa (AFD integral).
 * @returns {Array<{from: number, to: number}>}
 */
function findNsrGaps(nsrs, expectedFirst = null) {
    const sorted = [...new Set(nsrs)].sort((a, b) => a - b);
    const gaps = [];

    if (!sorted.length) return gaps;

    if (expectedFirst !== null && sorted[0] > expectedFirst) {
        gaps.push({ from: expectedFirst, to: sorted[0] - 1 });
    }

    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] !== sorted[i - 1] + 1) {
            gaps.push({ from: sorted[i - 1] + 1, to: sorted[i] - 1 });
        }
    }

    return gaps;
}

/**
 * Compara a contagem por tipo com o trailer.
 *
 * @param {Array<{recordType: number}>} records
 * @param {object|null} trailer - saída de `parseTrailer`.
 * @returns {{check: string, expected: object|null, found: object}}
 */
function checkTrailer(records, trailer) {
    const found = { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
    for (const record of records) {
        found[record.recordType] = (found[record.recordType] ?? 0) + 1;
    }

    if (!trailer) return { check: TrailerCheck.ABSENT, expected: null, found };

    const matches = Object.keys(found).every((type) => found[type] === trailer[type]);
    return { check: matches ? TrailerCheck.OK : TrailerCheck.MISMATCH, expected: trailer, found };
}

/**
 * Separa os registros recebidos em novos, idênticos ao já gravado e
 * divergentes.
 *
 * Idempotência é isto: reimportar o mesmo AFD cai inteiro em `identical`, e
 * nada é escrito.
 *
 * @param {Array<{nsr: number, rawLine: string}>} records
 * @param {Map<number, string>} existing - NSR → `raw_line` já gravada.
 * @returns {{fresh: object[], identical: number, conflicts: number[]}}
 */
function splitByExisting(records, existing) {
    const fresh = [];
    const conflicts = [];
    let identical = 0;
    const seen = new Set();

    for (const record of records) {
        // NSR repetido DENTRO da mesma resposta: só o primeiro conta. Gravar os
        // dois estouraria a chave primária no meio do lote.
        if (seen.has(record.nsr)) {
            conflicts.push(record.nsr);
            continue;
        }
        seen.add(record.nsr);

        if (!existing.has(record.nsr)) {
            fresh.push(record);
        } else if (existing.get(record.nsr) === record.rawLine) {
            identical += 1;
        } else {
            conflicts.push(record.nsr);
        }
    }

    return { fresh, identical, conflicts };
}

/** `[{from:5,to:5},{from:9,to:12}]` → `"5, 9–12"` */
function formatGaps(gaps) {
    return gaps.map(({ from, to }) => (from === to ? `${from}` : `${from}–${to}`)).join(', ');
}

module.exports = { findNsrGaps, checkTrailer, splitByExisting, formatGaps };
