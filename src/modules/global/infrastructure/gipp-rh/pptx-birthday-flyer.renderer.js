/**
 * @fileoverview Gera o cartaz de aniversariantes em `.pptx` — implementa
 * `BirthdayFlyerRendererPort`.
 *
 * O fundo (`templates/birthday-flyer/background.png`) é a arte do RH inteira:
 * balões, logo, título e o cartão com cabeçalho NOME | SETOR | DATA e 19 linhas
 * pautadas. Por cima vão só os dados, numa tabela sem borda cujas linhas caem
 * exatamente nas da arte — por isso as medidas abaixo estão em pixels da imagem
 * (842 × 1191) e não arredondadas. Trocar a arte exige medir de novo.
 *
 * Saída em `.pptx` (e não PDF) de propósito: o RH ainda ajusta à mão antes de
 * imprimir (apelido, setor), como fazia no modelo.
 *
 * @module modules/global/infrastructure/gipp-rh/pptx-birthday-flyer.renderer
 */

const path = require('path');
const { BirthdayFlyerRendererPort } = require('../../application/gipp-rh/birthday/ports/birthday-flyer-renderer.port');
const { ROWS_PER_SLIDE } = require('../../domain/gipp-rh/birthday.rules');

const BACKGROUND = path.resolve(__dirname, '../../../../templates/birthday-flyer/background.png');

// ─── Geometria da arte ─────────────────────────────────────────────────────────
const IMAGE_PX = { w: 842, h: 1191 };
const SLIDE_W = 10.5;                                   // polegadas (largura do modelo)
const PX = SLIDE_W / IMAGE_PX.w;                        // polegadas por pixel
const SLIDE_H = IMAGE_PX.h * PX;                        // ≈ 14,85" — proporção A3

const FIRST_ROW_TOP_PX = 368;                           // fim do cabeçalho laranja
const LAST_LINE_PX = 1112;                              // 19ª linha pautada
const ROW_H = ((LAST_LINE_PX - FIRST_ROW_TOP_PX) / ROWS_PER_SLIDE) * PX;

// Início de cada coluna = onde começa o texto do cabeçalho na arte.
const COL_NAME_PX = 100;
const COL_SECTOR_PX = 437;
const COL_DATE_PX = 675;
const CARD_RIGHT_PX = 783;

const COL_W = [
    (COL_SECTOR_PX - COL_NAME_PX) * PX,
    (COL_DATE_PX - COL_SECTOR_PX) * PX,
    (CARD_RIGHT_PX - COL_DATE_PX) * PX,
];

// Faixa verde entre o subtítulo e o cartão, onde vai "OUTUBRO · INTERLAGOS".
const TAG_CENTER_X = 522 * PX;
const TAG_Y = 240 * PX;
const TAG_H = 34 * PX;
const TAG_MAX_W = 5.0;

// ─── Estilo ────────────────────────────────────────────────────────────────────
const FONT = 'Arial';
const TEXT_COLOR = '1F2A1F';
const ACCENT = 'D44A15';                                // laranja do cabeçalho da arte
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

class PptxBirthdayFlyerRenderer extends BirthdayFlyerRendererPort {
    async render({ monthName, slides }) {
        // Require tardio: o `routes.js` carrega este arquivo no boot, e uma imagem
        // construída sem o pacote derrubaria a API inteira — assim cai só esta rota.
        const PptxGenJS = require('pptxgenjs');
        const pres = new PptxGenJS();
        pres.defineLayout({ name: 'BIRTHDAY_FLYER', width: SLIDE_W, height: SLIDE_H });
        pres.layout = 'BIRTHDAY_FLYER';
        pres.title = `Aniversariantes de ${monthName}`;
        pres.company = 'Peg Pese';

        pres.defineSlideMaster({
            title: 'ANIVERSARIANTES',
            background: { path: BACKGROUND },
        });

        for (const page of slides) {
            const slide = pres.addSlide({ masterName: 'ANIVERSARIANTES' });

            const tag = `${monthName} · ${page.branchName}`.toUpperCase();
            const tagW = Math.min(TAG_MAX_W, Math.max(2.6, tag.length * 0.15 + 0.6));
            slide.addText(tag, {
                shape: pres.ShapeType.roundRect,
                rectRadius: TAG_H / 2,
                x: TAG_CENTER_X - tagW / 2,
                y: TAG_Y,
                w: tagW,
                h: TAG_H,
                fill: { color: 'FFFFFF' },
                line: { color: 'FFFFFF' },
                fontFace: FONT,
                fontSize: tag.length > 30 ? 14 : 16,
                bold: true,
                color: ACCENT,
                align: 'center',
                valign: 'middle',
                charSpacing: 1,
                margin: 0,
                objectName: 'Filial',
            });

            const rows = page.people.map(person => [
                cell(person.name, COL_W[0]),
                cell(person.sector, COL_W[1]),
                cell(person.date, COL_W[2], { color: ACCENT }),
            ]);

            slide.addTable(rows, {
                x: COL_NAME_PX * PX,
                y: FIRST_ROW_TOP_PX * PX,
                w: COL_W.reduce((a, b) => a + b, 0),
                colW: COL_W,
                rowH: ROW_H,
                fontFace: FONT,
                bold: true,
                color: TEXT_COLOR,
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

module.exports = { PptxBirthdayFlyerRenderer, fitFontSize };
