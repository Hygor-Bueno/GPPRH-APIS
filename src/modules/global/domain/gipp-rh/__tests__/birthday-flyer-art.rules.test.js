/**
 * @fileoverview Regras da arte do cartaz por empresa: empresa pela filial,
 * proporção, layout escalado e validação das medidas.
 */

const {
    FlyerArtErrorCode,
    DEFAULT_IMAGE,
    DEFAULT_LAYOUT,
    companyCodeOf,
    normalizeCompanyCode,
    assertPosterProportion,
    scaleDefaultLayout,
    parseLayoutInput,
    resolveLayout,
    toFlyerArtEntry,
} = require('../birthday-flyer-art.rules');
const { paginate } = require('../birthday.rules');

describe('empresa', () => {
    it('é o prefixo da filial', () => {
        expect(companyCodeOf('0202')).toBe('02');
        expect(companyCodeOf('0101')).toBe('01');
    });

    it.each(['02', ' 01 '])('aceita %p', raw => {
        expect(normalizeCompanyCode(raw)).toBe(String(raw).trim());
    });

    it.each([undefined, '', '2', '0202', 'AB'])('recusa %p', raw => {
        expect(() => normalizeCompanyCode(raw)).toThrow(expect.objectContaining({
            statusCode: 400, code: FlyerArtErrorCode.InvalidCompany,
        }));
    });
});

describe('assertPosterProportion', () => {
    it('aceita a arte padrão e o dobro dela', () => {
        expect(() => assertPosterProportion(DEFAULT_IMAGE)).not.toThrow();
        expect(() => assertPosterProportion({ width: 1684, height: 2382 })).not.toThrow();
    });

    it('aceita A3 em 300 dpi (3508 × 4961)', () => {
        expect(() => assertPosterProportion({ width: 3508, height: 4961 })).not.toThrow();
    });

    it('recusa paisagem e quadrada, dizendo a altura esperada', () => {
        expect(() => assertPosterProportion({ width: 1000, height: 1000 })).toThrow(expect.objectContaining({
            code: FlyerArtErrorCode.InvalidProportion,
            message: expect.stringContaining('1414 px'),
        }));
        expect(() => assertPosterProportion({ width: 1191, height: 842 }))
            .toThrow(expect.objectContaining({ code: FlyerArtErrorCode.InvalidProportion }));
    });
});

describe('scaleDefaultLayout', () => {
    it('no tamanho padrão devolve o próprio layout padrão', () => {
        expect(scaleDefaultLayout(DEFAULT_IMAGE)).toEqual(DEFAULT_LAYOUT);
    });

    it('no dobro, dobra as medidas e mantém cores e linhas', () => {
        const layout = scaleDefaultLayout({ width: 1684, height: 2382 });
        expect(layout.first_row_top_px).toBe(736);
        expect(layout.col_sector_px).toBe(874);
        expect(layout.rows_per_slide).toBe(DEFAULT_LAYOUT.rows_per_slide);
        expect(layout.accent_color).toBe(DEFAULT_LAYOUT.accent_color);
    });
});

describe('parseLayoutInput', () => {
    it('ausente vira objeto vazio', () => {
        expect(parseLayoutInput(undefined)).toEqual({});
        expect(parseLayoutInput('')).toEqual({});
    });

    it('aceita JSON em texto (multipart) e objeto', () => {
        expect(parseLayoutInput('{"rows_per_slide":15}')).toEqual({ rows_per_slide: 15 });
        expect(parseLayoutInput({ accent_color: '#00AA00' })).toEqual({ accent_color: '#00AA00' });
    });

    it.each(['{', '[1]', '"x"', { foo: 1 }])('recusa %p', raw => {
        expect(() => parseLayoutInput(raw))
            .toThrow(expect.objectContaining({ code: FlyerArtErrorCode.InvalidLayout }));
    });
});

describe('resolveLayout', () => {
    it('sobrepõe só o que veio e normaliza a cor', () => {
        const layout = resolveLayout(DEFAULT_LAYOUT, { rows_per_slide: 15, accent_color: '#00aa00' }, DEFAULT_IMAGE);
        expect(layout).toEqual({ ...DEFAULT_LAYOUT, rows_per_slide: 15, accent_color: '00AA00' });
    });

    it.each([
        [{ col_sector_px: 90 }, 'colunas fora de ordem'],
        [{ card_right_px: 900 }, 'cartão além da largura'],
        [{ last_line_px: 300 }, 'última linha antes da primeira'],
        [{ last_line_px: 1300 }, 'última linha além da altura'],
        [{ rows_per_slide: 0 }, 'zero linhas'],
        [{ rows_per_slide: 40 }, 'linhas baixas demais'],
        [{ tag_y_px: 1180 }, 'faixa fora da imagem'],
        [{ first_row_top_px: -1 }, 'negativo'],
        [{ col_name_px: 10.5 }, 'não inteiro'],
        [{ text_color: 'verde' }, 'cor inválida'],
    ])('recusa %p (%s)', overrides => {
        expect(() => resolveLayout(DEFAULT_LAYOUT, overrides, DEFAULT_IMAGE))
            .toThrow(expect.objectContaining({ statusCode: 400, code: FlyerArtErrorCode.InvalidLayout }));
    });
});

describe('toFlyerArtEntry', () => {
    const company = { code: '02', name: 'PEG PESE SUPERMERCADOS' };

    it('sem arte própria, devolve a padrão', () => {
        expect(toFlyerArtEntry(company, null)).toEqual({
            companyCode: '02', companyName: 'PEG PESE SUPERMERCADOS', custom: false, fileId: null,
            imageWidth: 842, imageHeight: 1191, layout: DEFAULT_LAYOUT, updatedAt: null, updatedBy: null,
        });
    });

    it('com arte própria, devolve a gravada', () => {
        const art = { file_id: 5, image_width: 1684, image_height: 2382, layout: { x: 1 }, updated_at: 'd', updated_by: 7 };
        expect(toFlyerArtEntry(company, art)).toMatchObject({ custom: true, fileId: 5, imageWidth: 1684, layout: { x: 1 }, updatedBy: 7 });
    });
});

describe('paginate com linhas por empresa', () => {
    it('usa a quantidade de linhas da arte de cada filial', () => {
        const people = Array.from({ length: 5 }, (_, i) => ({ name: `P${i}` }));
        const slides = paginate(
            [{ branchCode: '0102', branchName: 'A', people }, { branchCode: '0202', branchName: 'B', people }],
            branchCode => (branchCode.startsWith('01') ? 2 : 19),
        );
        expect(slides.map(s => [s.branchCode, s.page, s.people.length])).toEqual([
            ['0102', 1, 2], ['0102', 2, 2], ['0102', 3, 1], ['0202', 1, 5],
        ]);
    });
});
