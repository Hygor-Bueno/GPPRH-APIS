/**
 * @fileoverview Validadores de nome de arquivo, extensão e consistência MIME.
 *
 * Porta de `PHP/GLOBAL/Utils/file/Validators.php`.
 *
 * @module utils/file/validators
 */

const path = require('path');
const {
    BLOCKED_EXTENSIONS,
    BLOCKED_FILENAMES,
    EXT_TO_EXPECTED_MIME,
    MODULE_PATTERN,
} = require('./constants');
const { AppError } = require('../../errors/app.error');

/**
 * Remove tentativas de path traversal e caracteres perigosos do nome original.
 *
 * A allowlist é Unicode: acento é conteúdo legítimo de nome de arquivo, não
 * ameaça. A versão anterior era `[^a-zA-Z0-9.\-_\s]`, que transformava
 * "Lançar recibo.pdf" em "Lan_ar recibo.pdf" — e era esse nome mutilado que ia
 * parar em `_files.file_name` e aparecia na tela do usuário.
 *
 * A troca é segura porque o nome sanitizado NUNCA vira caminho em disco: o
 * arquivo é gravado com o hash SHA-256 como nome (ver `FileService._buildPaths`).
 * O papel desta função é barrar path traversal e caractere perigoso, e isso
 * continua valendo — separador de caminho, caractere de controle, inválidos de
 * Windows (`: * ? " < > |`) e formatadores invisíveis (como o override RTL, usado
 * para disfarçar extensão) seguem virando `_`.
 *
 * @param {string} name - Nome original do arquivo (`file.originalname`).
 * @returns {string} Nome sanitizado, máximo 200 caracteres.
 */
function sanitizeFilename(name) {
    // Remove qualquer componente de path (../../etc/passwd → passwd)
    const base = path.basename(String(name ?? ''));

    // Letras de qualquer alfabeto, números, marcas de combinação (acento em
    // forma decomposta), ponto, hífen, underscore e espaço. O resto vira `_`.
    let safe = base.replace(/[^\p{L}\p{N}\p{M}.\-_\s]/gu, '_');
    safe = safe.replace(/\.{2,}/g, '.');        // bloqueia double dots
    safe = safe.trim().substring(0, 200);

    return safe || 'file';
}

/**
 * Bloqueia extensões perigosas, dotfiles e nomes reservados de sistema.
 *
 * @param {string} safeName - Nome já sanitizado por `sanitizeFilename`.
 * @throws {AppError} 400 em caso de extensão ou nome proibido.
 */
function validateExtension(safeName) {
    const lower = safeName.toLowerCase();
    const ext   = path.extname(safeName).replace('.', '').toLowerCase();

    if (safeName.startsWith('.')) {
        throw new AppError('Arquivos ocultos (dotfiles) não são permitidos.', 400);
    }

    if (BLOCKED_FILENAMES.includes(lower)) {
        throw new AppError(`Nome de arquivo "${safeName}" não é permitido.`, 400);
    }

    if (!ext || ext === lower) {
        throw new AppError('Arquivos sem extensão não são permitidos.', 400);
    }

    if (BLOCKED_EXTENSIONS.includes(ext)) {
        throw new AppError(`Extensão ".${ext}" não é permitida.`, 400);
    }
}

/**
 * Garante que a extensão declarada no nome do arquivo corresponde ao MIME
 * detectado por magic bytes.
 * Impede o bypass de um EXE renomeado para .pdf que sobreviveria à lista de bloqueio.
 *
 * Antes isto RECUSAVA o upload quando nome e conteúdo divergiam. Deixou de
 * fazer sentido: quando esta função roda, o conteúdo já foi provado como tipo
 * da whitelist (`detect()` só devolve tipos conhecidos, e o chamador já
 * rejeitou o que não tem extensão mapeada). A checagem só comparava com o nome
 * enviado pelo cliente, e recusava arquivo legítimo — ".xlsx" que era .xls
 * legado, ".png" que era WebP, coisas que ERP e editor de imagem produzem o
 * tempo todo.
 *
 * Quem protege de fato é o conteúdo: magic bytes, scan de ameaça binária, scan
 * de código em texto e verificação de zip bomb. Todos continuam valendo.
 *
 * @param {string} mimeType          - MIME real detectado por `MimeDetector.detect()`.
 * @param {string} safeName          - Nome sanitizado do arquivo.
 * @param {string} expectedExtension - Extensão correspondente ao MIME real.
 * @returns {{name: string, corrected: boolean, claimedExtension: string}}
 */
function reconcileExtension(mimeType, safeName, expectedExtension) {
    const ext     = path.extname(safeName).replace('.', '').toLowerCase();
    const allowed = EXT_TO_EXPECTED_MIME[ext] ?? null;

    // Nome já coerente com o conteúdo, ou extensão que não mapeamos: nada a fazer.
    if (allowed === null || allowed.includes(mimeType)) {
        return { name: safeName, corrected: false, claimedExtension: ext };
    }

    // Divergência. O conteúdo manda: corrige a extensão do nome para a real,
    // senão o usuário baixa "foto.png" que na verdade é WebP e o Windows abre
    // no programa errado.
    const base = ext ? safeName.slice(0, -(ext.length + 1)) : safeName;

    return {
        name: `${base}.${expectedExtension}`,
        corrected: true,
        claimedExtension: ext,
    };
}

/**
 * Valida o nome do módulo (letras maiúsculas, 2–8 chars).
 *
 * @param {string} module - Nome do módulo (ex: `'CHAT'`, `'GTPP'`).
 * @throws {AppError} 400 se o formato for inválido.
 */
function validateModule(module) {
    if (!MODULE_PATTERN.test(module)) {
        throw new AppError(
            `Módulo inválido: "${module}". Use apenas letras maiúsculas (ex: GTPP, CHAT).`,
            400
        );
    }
}

module.exports = {
    sanitizeFilename,
    validateExtension,
    reconcileExtension,
    validateModule,
};
