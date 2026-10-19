/**
 * @fileoverview Mescla de filiais na impressão do cartaz (`?merge=0202,0209`).
 */

const { BirthdayErrorCode, normalizeMergeGroups, mergeBranches } = require('../birthday.rules');

function person(name, day) {
    return { name, day };
}

const GROUPS = [
    { branchCode: '0202', branchName: 'INTERLAGOS', people: [person('Bruno', 3), person('Carla', 20)] },
    { branchCode: '0206', branchName: 'BOLONHA', people: [person('Davi', 1)] },
    { branchCode: '0209', branchName: 'ESCRITORIO CENTRAL', people: [person('Ana', 3), person('Eva', 9)] },
];

describe('normalizeMergeGroups', () => {
    it('ausente = sem mescla', () => {
        expect(normalizeMergeGroups(undefined)).toEqual([]);
        expect(normalizeMergeGroups('')).toEqual([]);
    });

    it('um grupo em texto, vários em array (merge repetido)', () => {
        expect(normalizeMergeGroups('0202, 0209')).toEqual([['0202', '0209']]);
        expect(normalizeMergeGroups(['0202,0209', '0102,0104'])).toEqual([['0202', '0209'], ['0102', '0104']]);
    });

    it.each([
        ['0202', 'uma filial só'],
        ['0202,0202', 'a mesma filial duas vezes'],
        ['0202,209', 'código sem zero à esquerda'],
        [['0202,0209', '0209,0206'], 'filial em duas mesclas'],
    ])('recusa %p (%s)', raw => {
        expect(() => normalizeMergeGroups(raw)).toThrow(expect.objectContaining({
            statusCode: 400, code: BirthdayErrorCode.InvalidMerge,
        }));
    });
});

describe('mergeBranches', () => {
    it('sem mescla devolve as filiais como estão', () => {
        expect(mergeBranches(GROUPS, [])).toBe(GROUPS);
    });

    it('junta no slide da principal, em ordem de dia e nome, e deixa as outras como estão', () => {
        const result = mergeBranches(GROUPS, [['0202', '0209']]);

        expect(result.map(g => [g.branchCode, g.branchName])).toEqual([
            ['0202', 'INTERLAGOS'],
            ['0206', 'BOLONHA'],
        ]);
        expect(result[0].people.map(p => p.name)).toEqual(['Ana', 'Bruno', 'Eva', 'Carla']);
        expect(result[0].mergedBranchCodes).toEqual(['0202', '0209']);
    });

    it('principal sem ninguém no mês: fica o código dela e o nome da primeira que tem gente', () => {
        const result = mergeBranches(GROUPS.filter(g => g.branchCode !== '0202'), [['0202', '0209']]);

        expect(result[0]).toMatchObject({ branchCode: '0202', branchName: 'ESCRITORIO CENTRAL' });
        expect(result[0].people).toHaveLength(2);
    });

    it('grupo sem ninguém no mês some', () => {
        const result = mergeBranches(GROUPS, [['0102', '0104']]);
        expect(result.map(g => g.branchCode)).toEqual(['0202', '0206', '0209']);
    });
});
