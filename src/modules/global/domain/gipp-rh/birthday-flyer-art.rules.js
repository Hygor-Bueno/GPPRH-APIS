/**
 * @fileoverview Regras puras da arte do cartaz de aniversariantes, por empresa.
 *
 * A arte (fundo do slide) muda por EMPRESA — Peg Pese, Frugal… —, não por
 * filial. No Protheus a empresa é o prefixo da filial: `0202` é a filial 02 da
 * empresa `02`. Empresa sem arte própria usa a arte padrão
 * (`templates/birthday-flyer/background.png`).
 *
 * Cada arte vem com o seu "layout": onde ficam as linhas pautadas, as colunas
 * NOME | SETOR | DATA e a faixa com mês e filial, em PIXELS DA IMAGEM. Os dados
 * são desenhados por cima, então essas medidas precisam bater com a arte. Se a
 * arte nova segue o mesmo modelo da padrão (o caso comum: muda logo e cores),
 * ninguém precisa medir — o layout padrão é escalado para o tamanho da imagem.
 *
 * Todas as artes ficam no mesmo arquivo `.pptx`, e o tamanho do slide é um só
 * por apresentação: por isso a arte precisa ter a proporção do cartaz (A3 em
 * pé, ≈ 1 : 1,414).
 *
 * @module modules/global/domain/gipp-rh/birthday-flyer-art.rules
 */

const { AppError } = require('../../../../errors/app.error');
const { ROWS_PER_SLIDE } = require('./birthday.rules');

/** `code` de todo `AppError` da gestão de artes. */
const FlyerArtErrorCode = Object.freeze({
    InvalidCompany: 'GIPPRH_FLYER_ART_INVALID_COMPANY',
    CompanyNotFound: 'GIPPRH_FLYER_ART_COMPANY_NOT_FOUND',
    ArtNotFound: 'GIPPRH_FLYER_ART_NOT_FOUND',
    ImageMissing: 'GIPPRH_FLYER_ART_IMAGE_MISSING',
    FileRequired: 'GIPPRH_FLYER_ART_FILE_REQUIRED',
    InvalidImage: 'GIPPRH_FLYER_ART_INVALID_IMAGE',
    InvalidProportion: 'GIPPRH_FLYER_ART_INVALID_PROPORTION',
    InvalidLayout: 'GIPPRH_FLYER_ART_INVALID_LAYOUT',
    MysqlError: 'GIPPRH_FLYER_ART_MYSQL_ERROR',
});

/** Tamanho, em pixels, da arte padrão. */
const DEFAULT_IMAGE = Object.freeze({ width: 842, height: 1191 });

/** Proporção do cartaz (altura / largura) e quanto uma arte pode fugir dela. */
const POSTER_RATIO = DEFAULT_IMAGE.height / DEFAULT_IMAGE.width;
const RATIO_TOLERANCE = 0.02;

/** Largura do slide, em polegadas. A altura sai da proporção do cartaz. */
const SLIDE_WIDTH_IN = 10.5;

/** Abaixo disso uma linha pautada não comporta o texto no corpo mínimo. */
const MIN_ROW_HEIGHT_IN = 0.3;
const MAX_ROWS_PER_SLIDE = 40;

/**
 * Medidas da arte padrão, em pixels de `DEFAULT_IMAGE`. Eram as constantes do
 * renderer até a arte passar a ser por empresa.
 */
const DEFAULT_LAYOUT = Object.freeze({
    rows_per_slide: ROWS_PER_SLIDE,
    first_row_top_px: 368,      // fim do cabeçalho laranja
    last_line_px: 1112,         // última linha pautada
    col_name_px: 100,           // início de cada coluna = onde começa o texto do cabeçalho
    col_sector_px: 437,
    col_date_px: 675,
    card_right_px: 783,
    tag_center_x_px: 522,       // faixa "OUTUBRO · INTERLAGOS"
    tag_y_px: 240,
    tag_height_px: 34,
    accent_color: 'D44A15',     // data e texto da faixa
    text_color: '1F2A1F',       // nome e setor
    tag_fill_color: 'FFFFFF',   // fundo da faixa
});

const PX_FIELDS = Object.freeze([
    'first_row_top_px', 'last_line_px', 'col_name_px', 'col_sector_px', 'col_date_px',
    'card_right_px', 'tag_center_x_px', 'tag_y_px', 'tag_height_px',
]);
const COLOR_FIELDS = Object.freeze(['accent_color', 'text_color', 'tag_fill_color']);
const LAYOUT_FIELDS = Object.freeze(['rows_per_slide', ...PX_FIELDS, ...COLOR_FIELDS]);

function layoutError(message) {
    return new AppError(message, 400, { code: FlyerArtErrorCode.InvalidLayout });
}

/**
 * @param {string} branchCode - '0202'.
 * @returns {string} '02'.
 */
function companyCodeOf(branchCode) {
    return String(branchCode ?? '').trim().slice(0, 2);
}

/**
 * @param {unknown} raw - `:companyCode` da rota.
 * @returns {string} dois dígitos, com zero à esquerda.
 */
function normalizeCompanyCode(raw) {
    const code = String(raw ?? '').trim();
    if (!/^\d{2}$/.test(code)) {
        throw new AppError('Empresa inválida. Use o código de 2 dígitos do Protheus (ex.: 02).', 400, {
            code: FlyerArtErrorCode.InvalidCompany,
        });
    }
    return code;
}

/**
 * A arte precisa ter a proporção do cartaz: o `.pptx` tem um tamanho de slide
 * só, e uma arte fora da proporção sairia esticada.
 *
 * @param {{ width: number, height: number }} size
 */
function assertPosterProportion({ width, height }) {
    if (!(width > 0 && height > 0)) {
        throw new AppError('Não foi possível ler as dimensões da imagem.', 400, {
            code: FlyerArtErrorCode.InvalidImage,
        });
    }
    const ratio = height / width;
    if (Math.abs(ratio - POSTER_RATIO) / POSTER_RATIO > RATIO_TOLERANCE) {
        const expectedHeight = Math.round(width * POSTER_RATIO);
        throw new AppError(
            `A arte precisa ter a proporção do cartaz (A3 em pé). Com ${width} px de largura, ` +
            `a altura deve ser ${expectedHeight} px; a imagem tem ${height} px.`,
            400,
            { code: FlyerArtErrorCode.InvalidProportion },
        );
    }
}

/**
 * Layout padrão levado para uma imagem de outro tamanho (mesmo modelo, outra
 * resolução). Cores e quantidade de linhas não mudam.
 *
 * @param {{ width: number, height: number }} size
 * @returns {typeof DEFAULT_LAYOUT}
 */
function scaleDefaultLayout({ width, height }) {
    const sx = width / DEFAULT_IMAGE.width;
    const sy = height / DEFAULT_IMAGE.height;
    const horizontal = new Set(['col_name_px', 'col_sector_px', 'col_date_px', 'card_right_px', 'tag_center_x_px']);
    const layout = { ...DEFAULT_LAYOUT };
    for (const field of PX_FIELDS) {
        layout[field] = Math.round(DEFAULT_LAYOUT[field] * (horizontal.has(field) ? sx : sy));
    }
    return layout;
}

/**
 * `layout` vem de multipart (string JSON) ou de JSON (objeto). Ausente = `{}`.
 *
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
function parseLayoutInput(raw) {
    if (raw === undefined || raw === null || raw === '') return {};
    let value = raw;
    if (typeof raw === 'string') {
        try {
            value = JSON.parse(raw);
        } catch {
            throw layoutError('`layout` precisa ser um JSON válido.');
        }
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw layoutError('`layout` precisa ser um objeto.');
    }
    const unknown = Object.keys(value).find(key => !LAYOUT_FIELDS.includes(key));
    if (unknown) throw layoutError(`Campo de layout desconhecido: '${unknown}'.`);
    return value;
}

/**
 * Junta o layout base com o que veio na requisição e confere tudo contra o
 * tamanho da imagem. Campos ausentes ficam como no base.
 *
 * @param {typeof DEFAULT_LAYOUT} base
 * @param {Record<string, unknown>} overrides - saída de `parseLayoutInput`.
 * @param {{ width: number, height: number }} size
 * @returns {typeof DEFAULT_LAYOUT}
 */
function resolveLayout(base, overrides, { width, height }) {
    const layout = { ...base };

    for (const field of ['rows_per_slide', ...PX_FIELDS]) {
        if (overrides[field] === undefined) continue;
        const value = Number(overrides[field]);
        if (!Number.isInteger(value) || value < 0) {
            throw layoutError(`'${field}' precisa ser um inteiro maior ou igual a zero.`);
        }
        layout[field] = value;
    }
    for (const field of COLOR_FIELDS) {
        if (overrides[field] === undefined) continue;
        const color = String(overrides[field]).trim().replace(/^#/, '').toUpperCase();
        if (!/^[0-9A-F]{6}$/.test(color)) {
            throw layoutError(`'${field}' precisa ser uma cor hexadecimal (ex.: D44A15).`);
        }
        layout[field] = color;
    }

    if (!(layout.rows_per_slide >= 1 && layout.rows_per_slide <= MAX_ROWS_PER_SLIDE)) {
        throw layoutError(`'rows_per_slide' vai de 1 a ${MAX_ROWS_PER_SLIDE}.`);
    }
    if (!(layout.col_name_px < layout.col_sector_px
        && layout.col_sector_px < layout.col_date_px
        && layout.col_date_px < layout.card_right_px
        && layout.card_right_px <= width)) {
        throw layoutError(`As colunas precisam estar em ordem (nome < setor < data < fim do cartão ≤ ${width} px).`);
    }
    if (!(layout.first_row_top_px < layout.last_line_px && layout.last_line_px <= height)) {
        throw layoutError(`A primeira linha precisa vir antes da última, e a última até ${height} px.`);
    }
    if (layout.tag_center_x_px > width || layout.tag_y_px + layout.tag_height_px > height || layout.tag_height_px < 1) {
        throw layoutError('A faixa de mês e filial precisa caber dentro da imagem.');
    }
    const rowHeightIn = ((layout.last_line_px - layout.first_row_top_px) / layout.rows_per_slide)
        * (SLIDE_WIDTH_IN * POSTER_RATIO / height);
    if (rowHeightIn < MIN_ROW_HEIGHT_IN) {
        throw layoutError('Linhas baixas demais para o texto: diminua `rows_per_slide` ou aumente a área das linhas.');
    }
    return layout;
}

/**
 * Linha do repositório → resposta. `layout` sai do jeito que foi gravado.
 *
 * @param {{ code: string, name: string }} company
 * @param {?{ file_id: number, image_width: number, image_height: number, layout: object,
 *            updated_at: Date, updated_by: number }} art
 */
function toFlyerArtEntry(company, art) {
    return {
        companyCode: company.code,
        companyName: company.name,
        custom: Boolean(art),
        fileId: art ? art.file_id : null,
        imageWidth: art ? art.image_width : DEFAULT_IMAGE.width,
        imageHeight: art ? art.image_height : DEFAULT_IMAGE.height,
        layout: art ? art.layout : { ...DEFAULT_LAYOUT },
        updatedAt: art ? art.updated_at : null,
        updatedBy: art ? art.updated_by : null,
    };
}

module.exports = {
    FlyerArtErrorCode,
    DEFAULT_IMAGE,
    DEFAULT_LAYOUT,
    POSTER_RATIO,
    SLIDE_WIDTH_IN,
    LAYOUT_FIELDS,
    companyCodeOf,
    normalizeCompanyCode,
    assertPosterProportion,
    scaleDefaultLayout,
    parseLayoutInput,
    resolveLayout,
    toFlyerArtEntry,
};
