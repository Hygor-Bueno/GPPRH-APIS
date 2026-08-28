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
 * @param {string} name - Nome original do arquivo (`file.originalname`).
 * @returns {string} Nome sanitizado, máximo 200 caracteres.
 */
function sanitizeFilename(name) {
    // Remove qualquer componente de path (../../etc/passwd → passwd)
    const base = path.basename(name);

    // Mantém apenas caracteres seguros
    let safe = base.replace(/[^a-zA-Z0-9.\-_\s]/g, '_');
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
 * @param {string} mimeType - MIME real detectado por `MimeDetector.detect()`.
 * @param {string} safeName - Nome sanitizado do arquivo.
 * @throws {AppError} 400 em caso de inconsistência.
 */
function validateMimeExtensionMatch(mimeType, safeName) {
    const ext     = path.extname(safeName).replace('.', '').toLowerCase();
    const allowed = EXT_TO_EXPECTED_MIME[ext] ?? null;

    if (allowed !== null && !allowed.includes(mimeType)) {
        throw new AppError(
            `Extensão ".${ext}" não corresponde ao conteúdo real do arquivo (detectado: ${mimeType}).`,
            400
        );
    }
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
    validateMimeExtensionMatch,
    validateModule,
};
