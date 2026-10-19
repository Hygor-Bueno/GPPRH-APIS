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
    normalizeExclusionInput,
    normalizeExclusionId,
    withoutExcluded,
    toExclusionEntry,
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

    it('entrada do cartaz não carrega o ano; a matrícula vai para a tela poder excluir', () => {
        const entry = toBirthdayEntry(row());
        expect(entry).toEqual({
            branchCode: '0202',
            branchName: 'INTERLAGOS',
            registration: '002351',
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

    it('devolve o CPF para a API aplicar a lista de exclusão', () => {
        expect(sqlFindBirthdaysByMonth(0)).toMatch(/RTRIM\(e\.RA_CIC\)\s+AS cpf/);
        expect(sqlFindBirthdaysByMonth(0)).toContain('u.cpf,');
    });
});

describe('withoutExcluded', () => {
    it('tira quem tem o CPF na lista, ignorando espaço do CHAR', () => {
        const rows = [row({ cpf: '11111111111' }), row({ cpf: '22222222222 ' }), row({ cpf: '33333333333' })];
        expect(withoutExcluded(rows, ['22222222222', '33333333333 ']).map(r => r.cpf)).toEqual(['11111111111']);
    });

    it('lista vazia não mexe nas linhas', () => {
        const rows = [row({ cpf: '11111111111' })];
        expect(withoutExcluded(rows, [])).toBe(rows);
    });

    it('a entrada da resposta não carrega o CPF', () => {
        expect(toBirthdayEntry(row({ cpf: '11111111111' }))).not.toHaveProperty('cpf');
    });
});

describe('normalizeExclusionInput', () => {
    it('completa a matrícula com zeros e limpa o motivo', () => {
        expect(normalizeExclusionInput({ branch_code: '0202', registration: '2351', reason: '  pediu  ' }))
            .toEqual({ branchCode: '0202', registration: '002351', reason: 'pediu' });
    });

    it('motivo vazio vira null', () => {
        expect(normalizeExclusionInput({ branch_code: '0202', registration: '002351', reason: ' ' }).reason).toBeNull();
    });

    it.each([
        [{}],
        [{ branch_code: '202', registration: '002351' }],
        [{ branch_code: '0202', registration: '0023510' }],
        [{ branch_code: '0202', registration: '23A' }],
    ])('recusa filial/matrícula inválida %p', body => {
        expect(() => normalizeExclusionInput(body)).toThrow(expect.objectContaining({
            statusCode: 400,
            code: BirthdayErrorCode.InvalidEmployee,
        }));
    });

    it('recusa motivo longo demais', () => {
        expect(() => normalizeExclusionInput({ branch_code: '0202', registration: '1', reason: 'x'.repeat(256) }))
            .toThrow(expect.objectContaining({ code: BirthdayErrorCode.InvalidReason }));
    });
});

describe('normalizeExclusionId', () => {
    it('aceita inteiro positivo', () => {
        expect(normalizeExclusionId('12')).toBe(12);
    });

    it.each([undefined, '', '0', '-1', '1.5', 'abc'])('recusa %p', raw => {
        expect(() => normalizeExclusionId(raw)).toThrow(expect.objectContaining({
            code: BirthdayErrorCode.InvalidExclusionId,
        }));
    });
});

describe('toExclusionEntry', () => {
    it('formata o contrato atual e não expõe CPF', () => {
        const entry = toExclusionEntry(
            { id: 3, cpf: '12345678901', reason: 'Pediu', created_at: '2026-10-19', created_by: 7 },
            {
                cpf: '12345678901', branch_code: '0202', branch_name: 'PEG PESE INTERLAGOS', registration: '002351',
                full_name: 'FERNANDA APARECIDA DOS SANTOS', cost_center: 'PERECIVEIS', dismissed: 0,
            },
        );
        expect(entry).toEqual({
            id: 3, branchCode: '0202', branchName: 'INTERLAGOS', registration: '002351',
            name: 'Fernanda Aparecida dos Santos', sector: 'Perecíveis', dismissed: false,
            reason: 'Pediu', createdAt: '2026-10-19', createdBy: 7,
        });
    });

    it('CPF sem contrato no Protheus sai com os dados nulos', () => {
        const entry = toExclusionEntry({ id: 4, cpf: '12345678901', reason: null, created_at: '2026-10-19', created_by: 7 }, null);
        expect(entry).toMatchObject({ branchCode: null, branchName: null, registration: null, name: null, dismissed: false });
    });
});
