const { findNsrGaps, checkTrailer, splitByExisting, formatGaps } = require('../afd/afd-integrity.rules');

describe('findNsrGaps', () => {
    test('sequência contínua não tem buraco', () => {
        expect(findNsrGaps([3, 1, 2, 4])).toEqual([]);
    });

    test('buraco no meio', () => {
        expect(findNsrGaps([1, 2, 5, 6, 9])).toEqual([{ from: 3, to: 4 }, { from: 7, to: 8 }]);
    });

    test('incremental que começa depois do NSR pedido também é buraco', () => {
        expect(findNsrGaps([105, 106], 100)).toEqual([{ from: 100, to: 104 }]);
    });

    test('resposta vazia não acusa nada', () => {
        expect(findNsrGaps([], 100)).toEqual([]);
    });

    test('formatGaps', () => {
        expect(formatGaps([{ from: 5, to: 5 }, { from: 9, to: 12 }])).toBe('5, 9–12');
    });
});

describe('checkTrailer', () => {
    const records = [{ recordType: 3 }, { recordType: 3 }, { recordType: 6 }];

    test('contagem igual ao trailer', () => {
        const trailer = { 2: 0, 3: 2, 4: 0, 5: 0, 6: 1, 7: 0 };
        expect(checkTrailer(records, trailer).check).toBe('ok');
    });

    test('contagem diferente', () => {
        const trailer = { 2: 0, 3: 3, 4: 0, 5: 0, 6: 1, 7: 0 };
        expect(checkTrailer(records, trailer).check).toBe('mismatch');
    });

    test('sem trailer', () => {
        expect(checkTrailer(records, null).check).toBe('absent');
    });
});

describe('splitByExisting — idempotência', () => {
    const a = { nsr: 1, rawLine: 'A' };
    const b = { nsr: 2, rawLine: 'B' };

    test('reimportar o mesmo AFD não produz nada a gravar', () => {
        const existing = new Map([[1, 'A'], [2, 'B']]);
        expect(splitByExisting([a, b], existing)).toEqual({ fresh: [], identical: 2, conflicts: [] });
    });

    test('só o que é novo é gravado', () => {
        const existing = new Map([[1, 'A']]);
        expect(splitByExisting([a, b], existing)).toEqual({ fresh: [b], identical: 1, conflicts: [] });
    });

    test('NSR já gravado com outra linha é conflito, nunca sobrescrita', () => {
        const existing = new Map([[1, 'OUTRA']]);
        const result = splitByExisting([a, b], existing);
        expect(result.fresh).toEqual([b]);
        expect(result.conflicts).toEqual([1]);
    });

    test('NSR repetido dentro da mesma resposta: só o primeiro entra', () => {
        const result = splitByExisting([a, { nsr: 1, rawLine: 'A2' }], new Map());
        expect(result.fresh).toEqual([a]);
        expect(result.conflicts).toEqual([1]);
    });
});
