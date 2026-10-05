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
function scanForBinaryThreats(buf, { allowWebScripts = false } = {}) {
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
    ];
    if (!allowWebScripts) {
        always.push(
            [Buffer.from('<script'), 'tag <script>'],
            [Buffer.from('<SCRIPT'), 'tag <script>'],
        );
    }
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
    const scan = _stripPdfStrings(buf.slice(0, Math.min(MAX_SCAN_BYTES, buf.length)).toString('binary'));

    for (const key of PDF_DANGEROUS_KEYS) {
        // Busca precisa: a chave PDF deve ser seguida de espaço, tab, newline
        // ou um delimitador PDF (< [ () >> ) — evita falsos positivos em nomes
        // de fontes embutidas como /AAAAAA+LiberationSans que contêm /AA.
        // O `>` e o `]` faltavam: `/S/JavaScript>>` (chave no fim do dicionário) passava.
        const pattern = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s<>\\[\\](/]', 'g');
        const hits = [...scan.matchAll(pattern)];

        // `/OpenAction` só é perigoso pela ação que dispara. InDesign e Acrobat
        // gravam por padrão um que apenas abre na página 1 (`/S/GoTo`) — esse
        // passa; qualquer outro tipo, ou um que não dê para resolver, segue bloqueado.
        const blocked = key === '/OpenAction'
            ? hits.some((m) => !_isGoToOpenAction(scan, m.index + key.length))
            : hits.length > 0;

        if (blocked) {
            throw new AppError(
                `PDF bloqueado: contém elemento perigoso "${key}". ` +
                'PDFs com JavaScript ou ações automáticas não são permitidos.',
                400
            );
        }
    }
}

/**
 * Diz se o valor de um `/OpenAction` é só navegação para uma página.
 *
 * Aceita as duas formas que os exportadores usam:
 *   - destino direto:    `/OpenAction [3 0 R /Fit]`
 *   - ação por referência: `/OpenAction 44 0 R` → `44 0 obj <</D[45 0 R/Fit]/S/GoTo>>`
 *
 * A ação referenciada precisa ser `/S/GoTo` (não `GoToR`/`GoToE`, que abrem
 * outro arquivo) e não pode encadear outra ação via `/Next`. Objeto que não se
 * acha no trecho escaneado (ex.: dentro de object stream comprimido) conta
 * como não inofensivo.
 *
 * @private
 * @param {string} scan  - PDF já sem o conteúdo das strings.
 * @param {number} start - Posição logo após a chave `/OpenAction`.
 * @returns {boolean}
 */
function _isGoToOpenAction(scan, start) {
    const value = scan.slice(start, start + 64);

    if (/^\s*\[/.test(value)) return true;

    const ref = value.match(/^\s*(\d+)\s+(\d+)\s+R\b/);
    if (!ref) return false;

    const obj = scan.match(new RegExp(`(?:^|[^\\d])${ref[1]}\\s+${ref[2]}\\s+obj([\\s\\S]*?)endobj`));
    if (!obj) return false;

    const body = obj[1];
    return /\/S\s*\/GoTo(?![A-Za-z])/.test(body) && !/\/Next(?![A-Za-z])/.test(body);
}

/**
 * Apaga o conteúdo das strings literais `( … )` do PDF que estão FORA de
 * streams, para que o scan veja só chaves de dicionário.
 *
 * Sem isto, todo link cuja URL contivesse um trecho como "/JavaScript/" ou
 * "/AA/" era recusado — `/URI(https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/)`
 * casava com a chave `/JavaScript`, embora seja só texto de uma ação `/URI`
 * inofensiva. Para o leitor de PDF, tudo entre parênteses é dado, nunca chave.
 *
 * Streams ficam de fora de propósito: o leitor pula o corpo pelo `/Length`, e
 * um `(` solto ali dentro abriria aqui uma "string" que engoliria os
 * dicionários seguintes — o que permitiria esconder um `/OpenAction` real. O
 * corpo do stream segue sendo escaneado exatamente como antes.
 *
 * @private
 * @param {string} pdf - Conteúdo em codificação 'binary'.
 * @returns {string}
 */
function _stripPdfStrings(pdf) {
    const parts = [];
    let copied = 0; // início do trecho ainda não copiado para `parts`
    let i = 0;

    while (i < pdf.length) {
        const ch = pdf[i];

        // Início de corpo de stream: pula sem tocar até `endstream`.
        if (ch === 's' && pdf.startsWith('stream', i) && !/[A-Za-z]/.test(pdf[i - 1] ?? '')) {
            const end = pdf.indexOf('endstream', i + 6);
            i = end === -1 ? pdf.length : end + 9;
            continue;
        }

        // String literal: pula até o `)` que a fecha, respeitando escape e
        // parênteses aninhados balanceados (as duas formas que a spec permite).
        if (ch === '(') {
            parts.push(pdf.slice(copied, i), '()');
            let depth = 1;
            i++;
            while (i < pdf.length && depth > 0) {
                if (pdf[i] === '\\') { i += 2; continue; }
                if (pdf[i] === '(') depth++;
                else if (pdf[i] === ')') depth--;
                i++;
            }
            copied = i;
            continue;
        }

        i++;
    }

    parts.push(pdf.slice(copied));
    return parts.join('');
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
