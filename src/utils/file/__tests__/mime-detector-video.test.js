const { detect } = require('../mime-detector');
const { reconcileExtension } = require('../validators');
const { MIME_TO_EXT, VIDEO_MIMES } = require('../constants');
const { AppError } = require('../../../errors/app.error');

/**
 * Cabeçalho ISO-BMFF mínimo: [tamanho do box][ftyp][marca principal][marcas
 * compatíveis]. É exatamente o trecho que o detector lê.
 */
function isoBmff(majorBrand, ...compatibleBrands) {
    const brands = [majorBrand, '\0\0\0\0', ...compatibleBrands].join('');
    const body = Buffer.from('ftyp' + brands, 'latin1');
    const size = Buffer.alloc(4);
    size.writeUInt32BE(body.length + 4);
    return Buffer.concat([size, body, Buffer.alloc(64)]);
}

/** EBML mínimo com o DocType em texto puro, como num arquivo real. */
function ebml(docType) {
    return Buffer.concat([
        Buffer.from([0x1A, 0x45, 0xDF, 0xA3]),
        Buffer.from('\x42\x82' + docType, 'latin1'),
        Buffer.alloc(32),
    ]);
}

describe('mime-detector — vídeo', () => {
    it('should detect the common MP4 brands', () => {
        for (const brand of ['isom', 'mp42', 'avc1', 'iso5']) {
            expect(detect(isoBmff(brand))).toBe('video/mp4');
        }
    });

    it('should detect an iPhone .mov as quicktime, not mp4', () => {
        expect(detect(isoBmff('qt  '))).toBe('video/quicktime');
    });

    it('should detect WebM', () => {
        expect(detect(ebml('webm'))).toBe('video/webm');
    });

    it('should reject Matroska — .mkv is not in the whitelist', () => {
        expect(() => detect(ebml('matroska'))).toThrow(AppError);
    });

    it('should fall back to the compatible brands when the major brand is exotic', () => {
        expect(detect(isoBmff('XXXX', 'isom'))).toBe('video/mp4');
    });

    it('should reject an unknown brand instead of assuming video', () => {
        expect(() => detect(isoBmff('XXXX', 'YYYY'))).toThrow(AppError);
    });
});

describe('mime-detector — ISO-BMFF que NÃO é vídeo', () => {
    // HEIC (foto padrão do iPhone) e AVIF usam o mesmo box `ftyp` do MP4. Sem a
    // recusa explícita, uma foto seria classificada como vídeo e gravada .mp4.
    it('should reject HEIC/HEIF, which shares the ftyp box with MP4', () => {
        for (const brand of ['heic', 'heix', 'mif1']) {
            expect(() => detect(isoBmff(brand))).toThrow(AppError);
        }
    });

    it('should reject AVIF', () => {
        expect(() => detect(isoBmff('avif'))).toThrow(AppError);
    });

    it('should reject audio-only containers', () => {
        expect(() => detect(isoBmff('M4A '))).toThrow(AppError);
    });

    it('should not rescue a HEIC through its compatible brands', () => {
        expect(() => detect(isoBmff('heic', 'mif1', 'isom'))).toThrow(AppError);
    });
});

describe('vídeo na whitelist de armazenamento', () => {
    it('should map every video MIME to an extension', () => {
        for (const mime of VIDEO_MIMES) {
            expect(MIME_TO_EXT[mime]).toBeTruthy();
        }
        expect(MIME_TO_EXT['video/mp4']).toBe('mp4');
        expect(MIME_TO_EXT['video/quicktime']).toBe('mov');
        expect(MIME_TO_EXT['video/webm']).toBe('webm');
    });

    // .mp4 e .mov são trocados o tempo todo (o iPhone grava QuickTime, apps
    // renomeiam para .mp4) — os dois se aceitam sem correção.
    it('should let .mp4 and .mov stand in for each other', () => {
        expect(reconcileExtension('video/quicktime', 'clipe.mp4', 'mov').corrected).toBe(false);
        expect(reconcileExtension('video/mp4', 'clipe.mov', 'mp4').corrected).toBe(false);
    });

    // Divergência real não recusa mais: corrige a extensão para a do conteúdo.
    it('should correct the extension when the content is something else entirely', () => {
        expect(reconcileExtension('application/pdf', 'clipe.mp4', 'pdf'))
            .toMatchObject({ name: 'clipe.pdf', corrected: true });
        expect(reconcileExtension('video/mp4', 'clipe.webm', 'mp4'))
            .toMatchObject({ name: 'clipe.mp4', corrected: true });
    });
});
