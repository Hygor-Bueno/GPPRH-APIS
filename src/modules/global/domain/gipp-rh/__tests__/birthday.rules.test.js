/**
 * @fileoverview Regras puras da lista de aniversariantes: entrada, formatação
 * de nome/setor/filial, ordem e quebra em slides.
 */

const {
    ROWS_PER_SLIDE,
    BirthdayErrorCode,
    normalizeMonth,
    normalizeBranchCodes,
    toTitleCase,
    sectorLabel,
    branchLabel,
    toBirthdayEntry,
    groupByBranch,
    paginate,
} = require('../birthday.rules');
const { sqlFindBirthdaysByMonth } = require('../../../repositories/sqlserver/birthday.queries');

function row(overrides = {}) {
    return {
        branch_code: '0202',
        branch_name: 'PEG PESE INTERLAGOS',
        registration: '002351',
        name: 'FERNANDA A DOS SANTOS',
        full_name: 'FERNANDA APARECIDA DOS SANTOS',
        birth_date: '19951001',
        cost_center: 'PERECIVEIS',
        ...overrides,
    };
}

describe('normalizeMonth', () => {
    it.each([['10', 10], [1, 1], ['01', 1], [' 12 ', 12]])('aceita %p', (raw, expected) => {
        expect(normalizeMonth(raw)).toBe(expected);
    });

    it.each([undefined, '', '0', '13', '2026-10', 'outubro', '1.5', -1])('recusa %p com code próprio', raw => {
        expect(() => normalizeMonth(raw)).toThrow(expect.objectContaining({
            statusCode: 400,
            code: BirthdayErrorCode.InvalidMonth,
        }));
    });
});

describe('normalizeBranchCodes', () => {
    it('vazio = todas as filiais', () => {
        expect(normalizeBranchCodes(undefined)).toEqual([]);
        expect(normalizeBranchCodes('')).toEqual([]);
    });

    it('mantém o zero à esquerda e remove repetidas', () => {
        expect(normalizeBranchCodes('0202, 0206,0202')).toEqual(['0202', '0206']);
        expect(normalizeBranchCodes(['0202'])).toEqual(['0202']);
    });

    it('recusa código fora do formato', () => {
        expect(() => normalizeBranchCodes('202')).toThrow(expect.objectContaining({
            code: BirthdayErrorCode.InvalidBranch,
        }));
        expect(() => normalizeBranchCodes("0202' OR 1=1")).toThrow(expect.objectContaining({
            code: BirthdayErrorCode.InvalidBranch,
        }));
    });
});

describe('formatação', () => {
    it('nome em título, partículas minúsculas no meio', () => {
        expect(toTitleCase('MARIA JOSE DA SILVA DE MELO')).toBe('Maria Jose da Silva de Melo');
        expect(toTitleCase('JEIRIS DEL CARMEN URBINA')).toBe('Jeiris del Carmen Urbina');
        expect(toTitleCase('ANA-LUISA D\'AVILA')).toBe('Ana-Luisa D\'Avila');
        expect(toTitleCase('  DOS  SANTOS ')).toBe('Dos Santos');
    });

    it('setor: rótulo da loja para CC abreviado, título para o resto', () => {
        expect(sectorLabel('FRENTE DE CX/TESOURARIA E CPD (IFOOD-CX)')).toBe('Frente de Caixa');
        expect(sectorLabel('E-COMMERCE (IFOOD SEPARADOR)')).toBe('iFood');
        expect(sectorLabel('PERECIVEIS')).toBe('Perecíveis');
        expect(sectorLabel('AÇOUGUE')).toBe('Açougue');
        expect(sectorLabel(null)).toBe('');
    });

    it('filial sem o "PEG PESE"; outras empresas mantêm o nome', () => {
        expect(branchLabel('PEG PESE INTERLAGOS', '0202')).toBe('INTERLAGOS');
        expect(branchLabel('FRUGAL BOLONHA', '0102')).toBe('FRUGAL BOLONHA');
        expect(branchLabel(null, '0999')).toBe('FILIAL 0999');
    });

    it('entrada do cartaz não carrega ano nem matrícula', () => {
        const entry = toBirthdayEntry(row());
        expect(entry).toEqual({
            branchCode: '0202',
            branchName: 'INTERLAGOS',
            name: 'Fernanda Aparecida dos Santos',
            sector: 'Perecíveis',
            day: 1,
            month: 10,
            date: '01/10',
        });
    });

    it('sem nome completo, usa RA_NOME', () => {
        expect(toBirthdayEntry(row({ full_name: '' })).name).toBe('Fernanda A dos Santos');
    });
});

describe('agrupamento e slides', () => {
    it('filiais em ordem de código, pessoas por dia e depois nome', () => {
        const entries = [
            row({ branch_code: '0206', branch_name: 'PEG PESE BOLONHA', full_name: 'ZECA', birth_date: '19900505' }),
            row({ full_name: 'BRUNO', birth_date: '19901008' }),
            row({ full_name: 'ANA', birth_date: '19801008' }),
            row({ full_name: 'CARLA', birth_date: '20001002' }),
        ].map(toBirthdayEntry);

        const groups = groupByBranch(entries);

        expect(groups.map(g => g.branchName)).toEqual(['INTERLAGOS', 'BOLONHA']);
        expect(groups[0].people.map(p => p.name)).toEqual(['Carla', 'Ana', 'Bruno']);
    });

    it(`quebra a filial a cada ${ROWS_PER_SLIDE} nomes (linhas da arte)`, () => {
        const people = Array.from({ length: 31 }, (_, i) => ({ name: `P${i}` }));
        const slides = paginate([
            { branchCode: '0202', branchName: 'INTERLAGOS', people },
            { branchCode: '0203', branchName: 'TABOAO', people: people.slice(0, 5) },
        ]);

        expect(slides.map(s => [s.branchName, s.page, s.pages, s.people.length])).toEqual([
            ['INTERLAGOS', 1, 2, 19],
            ['INTERLAGOS', 2, 2, 12],
            ['TABOAO', 1, 1, 5],
        ]);
    });
});

describe('sqlFindBirthdaysByMonth', () => {
    it('une as sete empresas, cada uma com o seu centro de custo', () => {
        const sql = sqlFindBirthdaysByMonth(0);
        for (const company of ['01', '02', '03', '06', '07', '08', '09']) {
            expect(sql).toContain(`SRA${company}0 e`);
            expect(sql).toContain(`CTT${company}0 cc`);
        }
        expect(sql).not.toMatch(/branch_code IN/);
    });

    it('filtro de filial só por parâmetro', () => {
        expect(sqlFindBirthdaysByMonth(2)).toContain('u.branch_code IN (@branch0, @branch1)');
    });
});
