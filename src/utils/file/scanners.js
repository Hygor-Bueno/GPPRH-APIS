/**
 * @fileoverview Scanners de segurança para conteúdo de arquivos.
 *
 * Todas as funções operam sobre um `Buffer` Node.js em memória.
 * Porta de `PHP/GLOBAL/Utils/file/Scanners.php`.
 *
 * @module utils/file/scanners
 */

const {
    MAX_SCAN_BYTES,
    MAX_IMAGE_DIMENSION,
    MAX_UNCOMPRESSED_BYTES,
    MAX_COMPRESSION_RATIO,
    CODE_CONTENT_PATTERNS,
    PDF_DANGEROUS_KEYS,
} = require('./constants');
const { AppError } = require('../../errors/app.error');

// ─── Scan universal (todos os tipos) ─────────────────────────────────────────

/**
 * Varre TODOS os tipos de arquivo em busca de executáveis embutidos
 * e strings de código sempre bloqueadas.
 *
 * Não varre tags HTML nem caminhos Linux aqui para evitar falsos
 * positivos em DOCX/XLSX (que são ZIPs contendo XML).
 *
 * @param {Buffer} buf - Conteúdo do arquivo.
 * @throws {AppError} 400 se uma ameaça for detectada.
 */
function scanForBinaryThreats(buf) {
    const scan = buf.slice(0, Math.min(MAX_SCAN_BYTES, buf.length));

    // Windows PE: cabeçalho MZ seguido de PE\x00\x00 nos próximos 512 bytes
    let pos = 0;
    while ((pos = _indexOf(scan, Buffer.from([0x4D, 0x5A]), pos)) !== -1) {
        if (_indexOf(scan.slice(pos + 2, pos + 514), Buffer.from([0x50, 0x45, 0x00, 0x00])) !== -1) {
            throw new AppError('Bloqueado: executável Windows (PE/EXE/DLL) detectado no arquivo.', 400);
        }
        pos += 2;
    }

    // ELF — Linux / Android: \x7F E L F
    if (_indexOf(scan, Buffer.from([0x7F, 0x45, 0x4C, 0x46])) !== -1) {
        throw new AppError('Bloqueado: executável ELF (Linux/Unix) detectado.', 400);
    }

    // Mach-O — macOS (fat binary, 64-bit, 32-bit)
    const machoSigs = [
        Buffer.from([0xCA, 0xFE, 0xBA, 0xBE]),
        Buffer.from([0xCF, 0xFA, 0xED, 0xFE]),
        Buffer.from([0xCE, 0xFA, 0xED, 0xFE]),
    ];
    for (const sig of machoSigs) {
        if (_indexOf(scan, sig) !== -1) {
            throw new AppError('Bloqueado: executável Mach-O (macOS) detectado.', 400);
        }
    }

    // Shebang — somente no byte 0
    if (scan[0] === 0x23 && scan[1] === 0x21) { // #!
        throw new AppError('Bloqueado: shebang de script detectado.', 400);
    }

    // PHP e <script — bloqueados em TODOS os tipos
    const always = [
        [Buffer.from('<?php'),   'código PHP'],
        [Buffer.from('<?PHP'),   'código PHP'],
        [Buffer.from('<script'), 'tag <script>'],
        [Buffer.from('<SCRIPT'), 'tag <script>'],
    ];
    for (const [needle, label] of always) {
        if (_indexOf(scan, needle) !== -1) {
            throw new AppError(`Bloqueado: ${label} detectado.`, 400);
        }
    }
}

// ─── Scan específico: PDF ─────────────────────────────────────────────────────

/**
 * Verifica keywords PDF que podem executar código no leitor.
 *
 * @param {Buffer} buf
 * @throws {AppError} 400 se keyword perigosa for encontrada.
 */
function scanPdfContent(buf) {
    const scan = buf.slice(0, Math.min(MAX_SCAN_BYTES, buf.length)).toString('binary');

    for (const key of PDF_DANGEROUS_KEYS) {
        // Busca precisa: a chave PDF deve ser seguida de espaço, tab, newline
        // ou um delimitador PDF (< [ () >> ) — evita falsos positivos em nomes
        // de fontes embutidas como /AAAAAA+LiberationSans que contêm /AA.
        const pattern = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s<\\[(/]');
        if (pattern.test(scan)) {
            throw new AppError(
                `PDF bloqueado: contém elemento perigoso "${key}". ` +
                'PDFs com JavaScript ou ações automáticas não são permitidos.',
                400
            );
        }
    }
}

// ─── Scan específico: text/plain e CSV ───────────────────────────────────────

/**
 * Varre arquivos text/plain e CSV em busca de padrões de código via regex.
 * Lê apenas os primeiros 8 KB (suficiente para capturar qualquer cabeçalho de script).
 *
 * @param {Buffer} buf
 * @throws {AppError} 400 se código for detectado.
 */
function scanForCode(buf) {
    const text = buf.slice(0, Math.min(8192, buf.length)).toString('utf-8');

    for (const [pattern, label] of CODE_CONTENT_PATTERNS) {
        if (pattern.test(text)) {
            throw new AppError(`Bloqueado: ${label} detectado.`, 400);
        }
    }
}

/**
 * Verifica densidade de caracteres em text/plain para detectar código ofuscado.
 *
 * @param {Buffer} buf
 * @throws {AppError} 400 se a densidade suspeita for detectada.
 */
function checkTextComplexity(buf) {
    const text      = buf.slice(0, Math.min(8192, buf.length)).toString('utf-8');
    const braces    = (text.match(/[{}]/g) || []).length;
    const backticks = (text.match(/`/g) || []).length;
    const brackets  = (text.match(/[\[\];]/g) || []).length;
    const codeChars = braces + backticks + brackets;
    const density   = text.length > 0 ? codeChars / text.length : 0;

    if (braces > 4) {
        throw new AppError('Bloqueado: uso excessivo de { } — possível código ofuscado.', 400);
    }
    if (backticks > 0) {
        throw new AppError('Bloqueado: backtick ` detectado — caractere de template literal JS.', 400);
    }
    if (density > 0.08) {
        throw new AppError('Bloqueado: alta densidade de caracteres suspeitos de código.', 400);
    }
}

// ─── Scan específico: DOCX / XLSX (zip bomb) ─────────────────────────────────

/**
 * Proteção contra zip bomb em arquivos DOCX e XLSX.
 *
 * Lê o Central Directory diretamente do Buffer (sem descompactar)
 * para somar o tamanho descomprimido total de todas as entradas.
 *
 * @param {Buffer} buf
 * @throws {AppError} 400 se o arquivo for suspeito de ser zip bomb.
 */
function checkZipBomb(buf) {
    // Localiza End of Central Directory (EOCD): PK\x05\x06
    const EOCD_SIG = Buffer.from([0x50, 0x4B, 0x05, 0x06]);
    let eocdPos = -1;

    for (let i = buf.length - 22; i >= 0; i--) {
        if (buf[i] === 0x50 && buf[i+1] === 0x4B && buf[i+2] === 0x05 && buf[i+3] === 0x06) {
            eocdPos = i;
            break;
        }
    }

    if (eocdPos === -1) {
        throw new AppError('Não foi possível inspecionar o arquivo ZIP.', 400);
    }

    // EOCD layout (22 bytes mínimos):
    // [4] sig | [2] disk# | [2] disk cd | [2] entries here | [2] total entries
    // [4] cd size | [4] cd offset | [2] comment len
    const totalEntries = buf.readUInt16LE(eocdPos + 10);
    const cdOffset     = buf.readUInt32LE(eocdPos + 16);

    // Itera pelo Central Directory para somar tamanhos descomprimidos
    let pos               = cdOffset;
    let uncompressedTotal = 0;

    for (let i = 0; i < totalEntries; i++) {
        if (pos + 46 > buf.length) break;
        // Central directory entry: PK\x01\x02
        if (buf[pos] !== 0x50 || buf[pos+1] !== 0x4B ||
            buf[pos+2] !== 0x01 || buf[pos+3] !== 0x02) break;

        uncompressedTotal += buf.readUInt32LE(pos + 24);
        const filenameLen  = buf.readUInt16LE(pos + 28);
        const extraLen     = buf.readUInt16LE(pos + 30);
        const commentLen   = buf.readUInt16LE(pos + 32);
        pos += 46 + filenameLen + extraLen + commentLen;
    }

    if (uncompressedTotal > MAX_UNCOMPRESSED_BYTES) {
        throw new AppError(
            'Bloqueado: arquivo expande para mais de 50 MB quando descomprimido (proteção zip bomb).',
            400
        );
    }

    const ratio = buf.length > 0 ? uncompressedTotal / buf.length : 0;
    if (ratio > MAX_COMPRESSION_RATIO) {
        throw new AppError(
            `Bloqueado: razão de compressão suspeita (${ratio.toFixed(1)}:1) — possível zip bomb.`,
            400
        );
    }
}

// ─── Scan específico: imagens ─────────────────────────────────────────────────

/**
 * Verifica as dimensões de imagens PNG, JPEG e WEBP diretamente do Buffer,
 * sem decodificar o arquivo. Impede que imagens com headers forjados (ex: PNG
 * declarando 100.000×100.000 px) esgotem a memória do processo.
 *
 * Limite: 8.000 × 8.000 px.
 *
 * @param {Buffer} buf
 * @param {string} mimeType - MIME real detectado (`image/png`, `image/jpeg`, `image/webp`).
 * @throws {AppError} 400 se as dimensões excederem o limite ou não puderem ser lidas.
 */
function checkImageDimensions(buf, mimeType) {
    let width = 0, height = 0;

    try {
        if (mimeType === 'image/png') {
            // IHDR chunk: bytes 16-19 = width, 20-23 = height (big-endian)
            if (buf.length < 24) throw new Error('buffer curto');
            width  = buf.readUInt32BE(16);
            height = buf.readUInt32BE(20);

        } else if (mimeType === 'image/jpeg') {
            // Percorre markers até SOF0 (FF C0) ou SOF2 (FF C2)
            let pos = 2;
            while (pos < buf.length - 8) {
                if (buf[pos] !== 0xFF) break;
                const marker = buf[pos + 1];
                if (marker === 0xC0 || marker === 0xC2) {
                    height = buf.readUInt16BE(pos + 5);
                    width  = buf.readUInt16BE(pos + 7);
                    break;
                }
                const segLen = buf.readUInt16BE(pos + 2);
                pos += 2 + segLen;
            }

        } else if (mimeType === 'image/webp') {
            if (buf.length < 30) throw new Error('buffer curto');
            const chunk = buf.slice(12, 16).toString('ascii');

            if (chunk === 'VP8 ') {
                // Lossy VP8: width nos bits 0-13 do word em offset 26, height em 28
                width  = (buf.readUInt16LE(26) & 0x3FFF) + 1;
                height = (buf.readUInt16LE(28) & 0x3FFF) + 1;
            } else if (chunk === 'VP8L') {
                // Lossless: bits 8-21 = width-1, bits 22-35 = height-1
                const b = buf.readUInt32LE(21);
                width  = (b & 0x3FFF) + 1;
                height = ((b >> 14) & 0x3FFF) + 1;
            } else if (chunk === 'VP8X') {
                // Extended: canvas width-1 em 24-26 (24-bit LE), height-1 em 27-29
                width  = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1;
                height = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1;
            }
        }
    } catch {
        throw new AppError('Não foi possível ler as dimensões da imagem.', 400);
    }

    if (!width || !height) {
        throw new AppError('Não foi possível ler as dimensões da imagem.', 400);
    }

    if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        throw new AppError(
            `Bloqueado: dimensões da imagem (${width}×${height}) excedem o limite ` +
            `(${MAX_IMAGE_DIMENSION}×${MAX_IMAGE_DIMENSION}).`,
            400
        );
    }
}

// ─── Helper privado ───────────────────────────────────────────────────────────

/**
 * Busca a primeira ocorrência de `needle` em `haystack` a partir de `offset`.
 * Wrapper sobre `Buffer.indexOf` com compatibilidade garantida.
 *
 * @private
 * @param {Buffer} haystack
 * @param {Buffer} needle
 * @param {number} [offset=0]
 * @returns {number} Índice ou -1 se não encontrado.
 */
function _indexOf(haystack, needle, offset = 0) {
    return haystack.indexOf(needle, offset);
}

module.exports = {
    scanForBinaryThreats,
    scanPdfContent,
    scanForCode,
    checkTextComplexity,
    checkZipBomb,
    checkImageDimensions,
};
