/**
 * @fileoverview Gera o cartaz de aniversariantes em `.pptx` — implementa
 * `BirthdayFlyerRendererPort`.
 *
 * O fundo de cada slide é a arte da empresa inteira: balões, logo, título e o
 * cartão com cabeçalho NOME | SETOR | DATA e as linhas pautadas. Por cima vão
 * só os dados, numa tabela sem borda cujas linhas caem exatamente nas da arte.
 * As medidas vêm do layout da arte, em pixels da imagem (ver
 * `birthday-flyer-art.rules`); aqui elas viram polegadas do slide.
 *
 * Saída em `.pptx` (e não PDF) de propósito: o RH ainda ajusta à mão antes de
 * imprimir (apelido, setor), como fazia no modelo.
 *
 * @module modules/global/infrastructure/gipp-rh/pptx-birthday-flyer.renderer
 */

const { BirthdayFlyerRendererPort } = require('../../application/gipp-rh/birthday/ports/birthday-flyer-renderer.port');
const { SLIDE_WIDTH_IN, POSTER_RATIO } = require('../../domain/gipp-rh/birthday-flyer-art.rules');

/** Um tamanho de slide por apresentação — por isso toda arte tem a proporção do cartaz. */
const SLIDE_W = SLIDE_WIDTH_IN;
const SLIDE_H = SLIDE_WIDTH_IN * POSTER_RATIO;          // ≈ 14,85" — proporção A3

const TAG_MAX_W = 5.0;

// ─── Estilo ────────────────────────────────────────────────────────────────────
const FONT = 'Arial';
const BODY_PT = 18;
/** Piso legível no cartaz impresso. Duas linhas de 13 pt (≈ 31 pt) cabem na linha pautada (≈ 35 pt). */
const MIN_PT = 13;
/** Largura média de um caractere em Arial negrito, em "em". Estimativa para caber na coluna. */
const AVG_CHAR_EM = 0.52;

/**
 * Maior corpo (até `BODY_PT`) em que o texto cabe numa linha da coluna. No
 * mínimo `MIN_PT` — abaixo disso quebra em duas linhas, que a altura comporta.
 */
function fitFontSize(text, widthIn) {
    const usable = widthIn - 0.12;                      // folga até a próxima coluna
    const fits = Math.floor((usable * 72) / (Math.max(text.length, 1) * AVG_CHAR_EM));
    return Math.max(MIN_PT, Math.min(BODY_PT, fits));
}

function cell(text, widthIn, extra = {}) {
    return {
        text,
        options: {
            fontSize: fitFontSize(text, widthIn),
            ...extra,
        },
    };
}

/**
 * Layout em pixels da imagem → posições em polegadas do slide. Escalas
 * separadas em x e y: a arte pode fugir até 2% da proporção e é esticada para
 * cobrir o slide — as medidas acompanham.
 *
 * @param {{ width: number, height: number, layout: object }} art
 */
function geometry({ width, height, layout }) {
    const sx = SLIDE_W / width;
    const sy = SLIDE_H / height;
    const colW = [
        (layout.col_sector_px - layout.col_name_px) * sx,
        (layout.col_date_px - layout.col_sector_px) * sx,
        (layout.card_right_px - layout.col_date_px) * sx,
    ];
    return {
        tableX: layout.col_name_px * sx,
        tableY: layout.first_row_top_px * sy,
        colW,
        rowH: ((layout.last_line_px - layout.first_row_top_px) / layout.rows_per_slide) * sy,
        tagCenterX: layout.tag_center_x_px * sx,
        tagY: layout.tag_y_px * sy,
        tagH: layout.tag_height_px * sy,
        accent: layout.accent_color,
        text: layout.text_color,
        tagFill: layout.tag_fill_color,
    };
}

class PptxBirthdayFlyerRenderer extends BirthdayFlyerRendererPort {
    async render({ monthName, slides, arts }) {
        // Require tardio: o `routes.js` carrega este arquivo no boot, e uma imagem
        // construída sem o pacote derrubaria a API inteira — assim cai só esta rota.
        const PptxGenJS = require('pptxgenjs');
        const pres = new PptxGenJS();
        pres.defineLayout({ name: 'BIRTHDAY_FLYER', width: SLIDE_W, height: SLIDE_H });
        pres.layout = 'BIRTHDAY_FLYER';
        pres.title = `Aniversariantes de ${monthName}`;
        pres.company = 'Peg Pese';

        const geometries = {};
        for (const [key, art] of Object.entries(arts)) {
            pres.defineSlideMaster({
                title: `ANIVERSARIANTES_${key}`,
                background: { data: `image/png;base64,${art.buffer.toString('base64')}` },
            });
            geometries[key] = geometry(art);
        }

        for (const page of slides) {
            const g = geometries[page.artKey];
            const slide = pres.addSlide({ masterName: `ANIVERSARIANTES_${page.artKey}` });

            const tag = `${monthName} · ${page.branchName}`.toUpperCase();
            const tagW = Math.min(TAG_MAX_W, Math.max(2.6, tag.length * 0.15 + 0.6));
            slide.addText(tag, {
                shape: pres.ShapeType.roundRect,
                rectRadius: g.tagH / 2,
                x: g.tagCenterX - tagW / 2,
                y: g.tagY,
                w: tagW,
                h: g.tagH,
                fill: { color: g.tagFill },
                line: { color: g.tagFill },
                fontFace: FONT,
                fontSize: tag.length > 30 ? 14 : 16,
                bold: true,
                color: g.accent,
                align: 'center',
                valign: 'middle',
                charSpacing: 1,
                margin: 0,
                objectName: 'Filial',
            });

            const rows = page.people.map(person => [
                cell(person.name, g.colW[0]),
                cell(person.sector, g.colW[1]),
                cell(person.date, g.colW[2], { color: g.accent }),
            ]);

            slide.addTable(rows, {
                x: g.tableX,
                y: g.tableY,
                w: g.colW.reduce((a, b) => a + b, 0),
                colW: g.colW,
                rowH: g.rowH,
                fontFace: FONT,
                bold: true,
                color: g.text,
                valign: 'middle',
                align: 'left',
                margin: 0,
                border: { type: 'none' },
                autoPage: false,
                objectName: 'Aniversariantes',
            });
        }

        return pres.write({ outputType: 'nodebuffer' });
    }
}

module.exports = { PptxBirthdayFlyerRenderer, fitFontSize, geometry };
