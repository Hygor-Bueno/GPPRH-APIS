/**
 * @fileoverview Detecção de MIME type por magic bytes.
 *
 * Opera 100% sobre o Buffer em memória — ignora qualquer informação
 * declarada pelo cliente (Content-Type, extensão do arquivo).
 *
 * Porta de `PHP/GLOBAL/Utils/file/MimeDetector.php`.
 *
 * @module utils/file/mime-detector
 */

const { AppError } = require('../../errors/app.error');

/**
 * Detecta o MIME type real de um arquivo pela análise dos seus bytes iniciais.
 *
 * @param {Buffer} buf - Conteúdo completo do arquivo em memória.
 * @returns {string} MIME type real (ex: `'image/jpeg'`, `'application/pdf'`).
 * @throws {AppError} 400 se o tipo não for reconhecido ou suportado.
 */
function detect(buf) {
    if (!buf || buf.length < 4) {
        throw new AppError('Arquivo inválido ou vazio.', 400);
    }

    // WEBP: RIFF????WEBP (12 bytes)
    if (buf.length >= 12 &&
        buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
        buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
        return 'image/webp';
    }

    // ISO-BMFF: box `ftyp` no offset 4 → MP4 / MOV (e também HEIC, que é imagem
    // e precisa ser recusada aqui — ver _detectIsoBmff).
    if (buf.length >= 12 &&
        buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
        return _detectIsoBmff(buf);
    }

    // EBML: 1A 45 DF A3 → WebM ou Matroska
    if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) {
        return _detectEbml(buf);
    }

    // ZIP → DOCX ou XLSX (PK magic: 50 4B 03 04)
    if (buf[0] === 0x50 && buf[1] === 0x4B) {
        return _detectOoxml(buf);
    }

    // OLE2 — DOC / XLS / PPT legado: D0 CF 11 E0
    if (buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0) {
        return _detectOle2(buf);
    }

    // PDF: %PDF (25 50 44 46)
    if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
        return 'application/pdf';
    }

    // PNG: 89 50 4E 47
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
        return 'image/png';
    }

    // JPEG: FF D8 FF
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
        return 'image/jpeg';
    }

    // XML: começa com <?xml ou <tag (sem null bytes)
    const sample = buf.slice(0, Math.min(512, buf.length));
    if (!sample.includes(0x00)) {
        const text = sample.toString('utf8');
        if (text.trimStart().startsWith('<?xml') || text.trimStart().startsWith('<')) {
            // Verifica se realmente parece XML antes de classificar
            if (/^<\?xml[\s\S]/i.test(text.trimStart()) || /^<[a-zA-Z][\s\S]*>/.test(text.trimStart())) {
                return 'application/xml';
            }
        }
        return 'text/plain';
    }

    throw new AppError('Tipo de arquivo não reconhecido ou não permitido.', 400);
}

// ─── Helpers privados ─────────────────────────────────────────────────────────

/**
 * Brands ISO-BMFF que são VÍDEO. A marca fica nos 4 bytes seguintes ao `ftyp`.
 * @private
 */
const ISOBMFF_VIDEO_BRANDS = new Set([
    'isom', 'iso2', 'iso4', 'iso5', 'iso6',   // ISO Base Media genéricas
    'mp41', 'mp42', 'mmp4',                   // MPEG-4
    'avc1', 'dash', 'cmfc',                   // H.264 / streaming
    'M4V ', 'M4VP',                           // vídeo Apple
    'qt  ',                                   // QuickTime (.mov do iPhone)
]);

/**
 * Brands ISO-BMFF que NÃO são vídeo e precisam ser recusadas explicitamente.
 *
 * HEIC/HEIF (foto padrão do iPhone) e AVIF usam o MESMO box `ftyp` do MP4 —
 * sem esta lista, uma foto HEIC seria classificada como vídeo e gravada com
 * extensão .mp4. M4A/M4B/M4P são áudio, que não está na whitelist.
 *
 * @private
 */
const ISOBMFF_NON_VIDEO_BRANDS = new Set([
    'heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1',  // HEIC/HEIF
    'avif', 'avis',                                                   // AVIF
    'M4A ', 'M4B ', 'M4P ',                                           // áudio
]);

/**
 * Distingue os arquivos que usam o container ISO-BMFF (box `ftyp`).
 *
 * A marca principal (offset 8..11) decide. Quando ela é desconhecida, olha as
 * marcas compatíveis listadas no resto do box `ftyp` — muito arquivo real traz
 * uma marca principal exótica e `isom` na lista de compatibilidade.
 *
 * @private
 * @param {Buffer} buf
 * @returns {string} `'video/mp4'` ou `'video/quicktime'`.
 * @throws {AppError} 400 se for HEIC/AVIF/áudio ou marca desconhecida.
 */
function _detectIsoBmff(buf) {
    const majorBrand = buf.slice(8, 12).toString('latin1');

    if (ISOBMFF_NON_VIDEO_BRANDS.has(majorBrand)) {
        throw new AppError(
            `Tipo de arquivo não permitido (contêiner ISO-BMFF com marca "${majorBrand.trim()}").`,
            400
        );
    }

    if (majorBrand === 'qt  ') return 'video/quicktime';
    if (ISOBMFF_VIDEO_BRANDS.has(majorBrand)) return 'video/mp4';

    // Marca principal desconhecida: procura uma compatível dentro do box `ftyp`.
    // O tamanho do box são os 4 primeiros bytes (big-endian); limitado a 1 KB
    // para não varrer o arquivo inteiro por causa de um cabeçalho corrompido.
    const boxSize = Math.min(buf.readUInt32BE(0) || 0, 1024);
    for (let offset = 16; offset + 4 <= boxSize && offset + 4 <= buf.length; offset += 4) {
        const brand = buf.slice(offset, offset + 4).toString('latin1');
        if (ISOBMFF_NON_VIDEO_BRANDS.has(brand)) break;
        if (brand === 'qt  ') return 'video/quicktime';
        if (ISOBMFF_VIDEO_BRANDS.has(brand)) return 'video/mp4';
    }

    throw new AppError('Tipo de arquivo não reconhecido ou não permitido.', 400);
}

/**
 * Distingue WebM de Matroska dentro do container EBML.
 *
 * Os dois compartilham o magic `1A 45 DF A3`; quem diferencia é o DocType, que
 * fica em texto puro logo no início. Só WebM está na whitelist — .mkv cai no
 * erro genérico de tipo não suportado.
 *
 * @private
 * @param {Buffer} buf
 * @returns {string} `'video/webm'`.
 * @throws {AppError} 400 se for Matroska ou DocType ausente.
 */
function _detectEbml(buf) {
    const head = buf.slice(0, Math.min(64, buf.length)).toString('latin1');
    if (head.includes('webm')) return 'video/webm';

    throw new AppError('Tipo de arquivo não reconhecido ou não permitido.', 400);
}

/**
 * Nome do stream principal dentro do OLE2 → MIME correspondente.
 *
 * O container OLE2 (`D0 CF 11 E0`) é o mesmo para DOC, XLS e PPT legados — o
 * magic byte sozinho não diz qual é. Quem diferencia é o nome do stream
 * principal, gravado em UTF-16LE na tabela de diretórios.
 *
 * @private
 */
const OLE2_STREAMS = [
    ['Workbook',            'application/vnd.ms-excel'],
    ['Book',                'application/vnd.ms-excel'],      // Excel 5.0/95
    ['WordDocument',        'application/msword'],
    ['PowerPoint Document', 'application/vnd.ms-powerpoint'],
];

/**
 * Distingue os formatos Office legados dentro de um container OLE2.
 *
 * Antes isto devolvia `application/msword` para qualquer OLE2, o que fazia uma
 * planilha .xls legada (inclusive salva com nome .xlsx, como exportam vários
 * ERPs) ser recusada por "extensão não corresponde ao conteúdo", e fazia uma
 * .xls legítima ser gravada em disco com extensão .doc.
 *
 * Critério de desempate: vence o marcador que aparece PRIMEIRO no arquivo. Um
 * documento com objeto embutido (uma planilha dentro de um .doc) contém os dois
 * streams, e o do documento principal precede o do objeto embutido.
 *
 * @private
 * @param {Buffer} buf
 * @returns {string} MIME do formato Office legado detectado.
 */
function _detectOle2(buf) {
    let bestMime  = null;
    let bestIndex = Infinity;

    for (const [streamName, mime] of OLE2_STREAMS) {
        const index = buf.indexOf(Buffer.from(streamName, 'utf16le'));
        if (index !== -1 && index < bestIndex) {
            bestIndex = index;
            bestMime  = mime;
        }
    }

    // OLE2 sem nenhum stream conhecido: mantém o comportamento antigo em vez de
    // recusar o arquivo — pode ser um formato Office mais exótico, e o container
    // já passou pelos scans de ameaça binária.
    return bestMime ?? 'application/msword';
}

/**
 * Valida a estrutura OOXML real dentro de um arquivo ZIP.
 * Lê o início e o fim do buffer para cobrir tanto o Local File Header
 * quanto o Central Directory, onde os nomes de entrada ficam não comprimidos.
 *
 * Formatos suportados:
 *  - DOCX / DOTX → word/document.xml
 *  - XLSX / XLTX → xl/workbook.xml
 *  - PPTX / PPSX / POTX → ppt/presentation.xml
 *
 * @private
 * @param {Buffer} buf
 * @returns {string} MIME type OOXML detectado.
 * @throws {AppError} 400 se o ZIP não for um arquivo Office válido.
 */
function _detectOoxml(buf) {
    const HEAD_SIZE = 8192;
    const TAIL_SIZE = 8192;

    const head   = buf.slice(0, Math.min(HEAD_SIZE, buf.length)).toString('binary');
    const tail   = buf.length > HEAD_SIZE
        ? buf.slice(Math.max(0, buf.length - TAIL_SIZE)).toString('binary')
        : '';
    const corpus = head + tail;

    const hasContentTypes = corpus.includes('[Content_Types].xml');
    const hasRels         = corpus.includes('_rels/');

    if (hasContentTypes && hasRels) {
        if (corpus.includes('word/document.xml')) {
            return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        }
        if (corpus.includes('xl/workbook.xml')) {
            return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        }
        if (corpus.includes('ppt/presentation.xml')) {
            return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        }
    }

    throw new AppError('Arquivo ZIP inválido: não é um arquivo Office suportado (DOCX, XLSX, PPTX).', 400);
}

module.exports = { detect };
