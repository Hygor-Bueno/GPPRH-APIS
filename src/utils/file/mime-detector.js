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

    // ZIP → DOCX ou XLSX (PK magic: 50 4B 03 04)
    if (buf[0] === 0x50 && buf[1] === 0x4B) {
        return _detectOoxml(buf);
    }

    // OLE2 — DOC / XLS legado: D0 CF 11 E0
    if (buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0) {
        return 'application/msword';
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
