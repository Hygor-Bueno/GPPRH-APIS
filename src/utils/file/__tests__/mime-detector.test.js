const { detect } = require('../mime-detector');
const { reconcileExtension } = require('../validators');
const { AppError } = require('../../../errors/app.error');

const OLE2_HEADER = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);

/**
 * OLE2 mínimo: o header do container seguido dos nomes de stream em UTF-16LE,
 * que é exatamente onde o detector procura. `streams` entra na ordem dada, e a
 * ordem importa — o desempate é por quem aparece primeiro.
 */
function ole2(...streams) {
    return Buffer.concat([
        OLE2_HEADER,
        Buffer.alloc(504),                                    // resto do header de 512 bytes
        ...streams.map(name => Buffer.from(name, 'utf16le')),
    ]);
}

describe('mime-detector — containers OLE2 (Office legado)', () => {
    it('should detect a legacy spreadsheet as ms-excel, not msword', () => {
        expect(detect(ole2('Workbook'))).toBe('application/vnd.ms-excel');
    });

    it('should detect the Excel 5.0/95 "Book" stream too', () => {
        expect(detect(ole2('Book'))).toBe('application/vnd.ms-excel');
    });

    it('should still detect a legacy Word document', () => {
        expect(detect(ole2('WordDocument'))).toBe('application/msword');
    });

    it('should detect a legacy PowerPoint presentation', () => {
        expect(detect(ole2('PowerPoint Document'))).toBe('application/vnd.ms-powerpoint');
    });

    it('should let the first stream win when a document embeds another', () => {
        expect(detect(ole2('WordDocument', 'Workbook'))).toBe('application/msword');
        expect(detect(ole2('Workbook', 'WordDocument'))).toBe('application/vnd.ms-excel');
    });

    it('should fall back to msword for an OLE2 with no known stream, instead of rejecting it', () => {
        expect(detect(ole2())).toBe('application/msword');
    });
});

describe('mime-detector — GIF', () => {
    // Logical Screen Descriptor 2×3 px logo depois da assinatura.
    const gif = sig => Buffer.concat([Buffer.from(sig, 'ascii'), Buffer.from([0x02, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00])]);

    it('should detect both GIF87a and GIF89a', () => {
        expect(detect(gif('GIF89a'))).toBe('image/gif');
        expect(detect(gif('GIF87a'))).toBe('image/gif');
    });

    it('should reject an unknown GIF version instead of taking it for an image', () => {
        expect(() => detect(gif('GIF88a'))).toThrow(AppError);
    });

    it('should read the dimensions from the logical screen descriptor', () => {
        const { checkImageDimensions } = require('../scanners');

        expect(() => checkImageDimensions(gif('GIF89a'), 'image/gif')).not.toThrow();
        const huge = gif('GIF89a');
        huge.writeUInt16LE(9000, 6);
        expect(() => checkImageDimensions(huge, 'image/gif')).toThrow(AppError);
    });
});

describe('reconcileExtension — nome divergente do conteúdo', () => {
    // O conteúdo já foi provado como tipo da whitelist antes desta função rodar.
    // Divergência de nome não recusa mais — corrige a extensão e segue.
    it('should accept a legacy .xls saved as .xlsx, correcting the extension', () => {
        const r = reconcileExtension('application/vnd.ms-excel', 'planilha.xlsx', 'xls');

        expect(r).toEqual({ name: 'planilha.xls', corrected: true, claimedExtension: 'xlsx' });
    });

    // O caso real reportado: PNG no nome, WebP no conteúdo.
    it('should accept a .png that is actually WebP, correcting the extension', () => {
        const r = reconcileExtension('image/webp', 'foto.png', 'webp');

        expect(r).toEqual({ name: 'foto.webp', corrected: true, claimedExtension: 'png' });
    });

    it('should leave a coherent name untouched', () => {
        const r = reconcileExtension('image/png', 'foto.png', 'png');

        expect(r).toEqual({ name: 'foto.png', corrected: false, claimedExtension: 'png' });
    });

    it('should keep dots inside the base name', () => {
        const r = reconcileExtension('image/webp', 'foto.final.v2.png', 'webp');

        expect(r.name).toBe('foto.final.v2.webp');
    });

    it('should keep accents when correcting', () => {
        expect(reconcileExtension('image/webp', 'Página inicial.png', 'webp').name)
            .toBe('Página inicial.webp');
    });

    it('should leave an unmapped extension alone', () => {
        const r = reconcileExtension('application/pdf', 'arquivo.qualquer', 'pdf');

        expect(r.corrected).toBe(false);
    });

    it('should never throw — rejection is no longer its job', () => {
        expect(() => reconcileExtension('application/pdf', 'planilha.xlsx', 'pdf')).not.toThrow();
        expect(reconcileExtension('application/pdf', 'planilha.xlsx', 'pdf').name).toBe('planilha.pdf');
    });
});
