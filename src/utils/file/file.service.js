/**
 * @fileoverview Serviço centralizado de upload de arquivos.
 *
 * Porta da classe `PHP/GLOBAL/Utils/FileService.php` adaptada para Node.js.
 *
 * Responsabilidades:
 *   - Validação multicamada (tamanho, extensão, MIME por magic bytes, ameaças binárias)
 *   - Scans específicos por tipo (PDF, text, imagem, OOXML)
 *   - Deduplicação via SHA-256 (verifica `_files.file_hash` antes de salvar)
 *   - Persistência em disco no padrão `Storage/{MODULO}/uploads/{YYYY}/{MM}/{DD}/{hash}.{ext}`
 *   - Registro na tabela `global._files`
 *   - Soft-delete (preserva o arquivo físico — outras entidades podem referenciar o mesmo `file_id`)
 *
 * Uso em rotas:
 * ```javascript
 * const { FileService } = require('../../../utils/file/file.service');
 *
 * // Middleware multer (memoryStorage, 10 MB)
 * router.post('/upload', authMiddleware, FileService.upload.single('file'),
 *     asyncHandler(async (req, res) => {
 *         const record = await FileService.save(req.file, 'CHAT', req.user.id);
 *         // record = { id, file_path, file_name, file_extension, file_type, file_size, file_hash }
 *         return respond.created(res, record);
 *     })
 * );
 * ```
 *
 * @module utils/file/file.service
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const multer = require('multer');

const { poolGlobal } = require('../../config/mysql');
const { AppError }   = require('../../errors/app.error');

const { detect }                  = require('./mime-detector');
const { sanitizeFilename, validateExtension, validateMimeExtensionMatch, validateModule } = require('./validators');
const { scanForBinaryThreats, scanPdfContent, scanForCode, checkTextComplexity, checkZipBomb, checkImageDimensions } = require('./scanners');
const { MAX_FILE_BYTES, MIME_TO_EXT } = require('./constants');
const { sqlFindByHash, sqlFindById, sqlInsertFile, sqlSoftDeleteFile } = require('../../modules/global/repositories/mysql/files.repository');

// ─── Constantes de armazenamento ──────────────────────────────────────────────

/**
 * Raiz do projeto — base para resolver `file_path` salvo em `_files`.
 * `__dirname` = `.../api/src/utils/file`
 * `../../..`  = `.../api/`
 *
 * `file_path` é armazenado como `Storage/uploads/{MODULE}/…` (relativo a esta raiz),
 * mantendo o mesmo padrão dos registros criados pelo PHP (`Storage/GTPP/uploads/…`).
 *
 * @constant {string}
 */
const STORAGE_ROOT = path.resolve(__dirname, '..', '..', '..');

/** MIMEs de imagem que recebem strip de metadados EXIF (quando possível). */
const IMAGE_MIMES  = new Set(['image/png', 'image/jpeg', 'image/webp']);
/** MIMEs de texto que recebem scan de código + complexidade. */
const TEXT_MIMES   = new Set(['text/plain', 'text/csv']);
/** MIMEs OOXML que recebem verificação de zip bomb. */
const OOXML_MIMES  = new Set([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
    'application/vnd.openxmlformats-officedocument.presentationml.template',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
]);

// ─── Middleware multer ────────────────────────────────────────────────────────

/**
 * Instância multer pré-configurada com `memoryStorage` e limite de 10 MB.
 * Use `FileService.upload.single('file')` nas rotas.
 *
 * @type {import('multer').Multer}
 */
const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: MAX_FILE_BYTES },
});

// ─── FileService ──────────────────────────────────────────────────────────────

class FileService {

    // ── Helper de banco ───────────────────────────────────────────────────────

    /**
     * @private
     */
    static async _execute(sql, params = []) {
        let conn;
        try {
            conn = await poolGlobal.getConnection();
            const [result] = await conn.execute(sql, params);
            return result;
        } finally {
            if (conn) conn.release();
        }
    }

    // ── API pública ───────────────────────────────────────────────────────────

    /**
     * Valida, escaneia, salva em disco e registra o arquivo na tabela `_files`.
     *
     * Se o mesmo conteúdo (hash SHA-256) já existir em `_files`, retorna o
     * registro existente sem gravar nada em disco (deduplicação).
     *
     * @param {Express.Multer.File} file   - Objeto `req.file` do multer (memoryStorage).
     * @param {string}              module - Módulo em maiúsculas (ex: `'CHAT'`, `'GTPP'`).
     * @param {number}              userId - ID do usuário autenticado (`req.user.id`).
     * @returns {Promise<Object>} Registro completo de `_files` com `id` disponível.
     * @throws {AppError} 400 para validações; 500 para falhas de I/O.
     */
    static async save(file, module, userId) {
        if (!file || !file.buffer) {
            throw new AppError('Nenhum arquivo recebido.', 400);
        }

        // `buf` e `mimeType` podem ser substituídos pela conversão WebP — usar let
        let buf = file.buffer;

        // ── Validação de tamanho ──────────────────────────────────────────────
        if (buf.length === 0) {
            throw new AppError('Arquivo vazio não é permitido.', 400);
        }
        if (buf.length > MAX_FILE_BYTES) {
            throw new AppError('Arquivo excede o tamanho máximo permitido de 10 MB.', 400);
        }

        // ── Validação de módulo ───────────────────────────────────────────────
        validateModule(module);

        // ── Camada 1: nome e extensão ─────────────────────────────────────────
        const safeName = sanitizeFilename(file.originalname);
        validateExtension(safeName);

        // ── Camada 2: MIME real por magic bytes ───────────────────────────────
        let mimeType = detect(buf);

        if (!MIME_TO_EXT[mimeType]) {
            throw new AppError(`Tipo de arquivo não suportado (detectado: ${mimeType}).`, 400);
        }

        validateMimeExtensionMatch(mimeType, safeName);

        // ── Camada 3: ameaças binárias (todos os tipos) ───────────────────────
        scanForBinaryThreats(buf);

        // ── Camada 4: scans específicos por tipo ──────────────────────────────
        if (mimeType === 'application/pdf') {
            scanPdfContent(buf);
        } else if (TEXT_MIMES.has(mimeType)) {
            scanForCode(buf);
            checkTextComplexity(buf);
        } else if (IMAGE_MIMES.has(mimeType)) {
            checkImageDimensions(buf, mimeType);
        } else if (OOXML_MIMES.has(mimeType)) {
            checkZipBomb(buf);
        }

        // ── Conversão para WebP (imagens PNG e JPEG) ──────────────────────────
        // Scans já rodaram no conteúdo original; a deduplicação e o armazenamento
        // usam o buffer final (já convertido) para máxima economia de espaço.
        if (IMAGE_MIMES.has(mimeType) && mimeType !== 'image/webp') {
            buf      = await FileService._convertToWebP(buf);
            mimeType = 'image/webp';
        }

        // Extensão resolvida após possível conversão
        const extension = MIME_TO_EXT[mimeType]; // 'webp', 'pdf', 'xlsx', etc.

        // ── Deduplicação via SHA-256 ──────────────────────────────────────────
        const fileHash = crypto.createHash('sha256').update(buf).digest('hex');
        const existing = await FileService._execute(sqlFindByHash(), [fileHash]);

        if (existing.length > 0) {
            return existing[0];
        }

        // ── Constrói caminhos de armazenamento ────────────────────────────────
        const { relativePath, absolutePath, absoluteDir } =
            FileService._buildPaths(fileHash, extension, module);

        // ── Persiste em disco ─────────────────────────────────────────────────
        fs.mkdirSync(absoluteDir, { recursive: true });
        fs.writeFileSync(absolutePath, buf, { mode: 0o644 });

        // EXIF/XMP já removidos pelo sharp durante a conversão WebP acima.
        // Arquivos não-imagem (PDF, DOCX…) não passam por strip.

        // ── Insere em `_files` ────────────────────────────────────────────────
        let insertResult;
        try {
            insertResult = await FileService._execute(sqlInsertFile(), [
                relativePath,
                safeName,
                extension,
                mimeType,
                buf.length,
                fileHash,
                userId,
                userId,
            ]);
        } catch (dbErr) {
            // Rollback: remove o arquivo físico se o banco falhar
            try { fs.unlinkSync(absolutePath); } catch { /* ignora */ }
            throw new AppError(`Erro ao registrar arquivo no banco: ${dbErr.message}`, 500);
        }

        // Busca o registro recém-inserido para retornar completo
        const rows = await FileService._execute(sqlFindById(), [insertResult.insertId]);
        return rows[0];
    }

    /**
     * Soft-delete de um arquivo: marca `status = 0` em `_files`.
     *
     * O arquivo físico é preservado pois outras entidades podem referenciar
     * o mesmo `file_id`. Use `FileService.deletePhysical()` apenas se tiver
     * certeza de que nenhuma outra entidade usa o arquivo.
     *
     * @param {number} fileId - ID do registro em `_files`.
     * @param {number} userId - ID do usuário autenticado.
     * @returns {Promise<void>}
     * @throws {AppError} 404 se o arquivo não existir ou já estiver inativo.
     */
    static async softDelete(fileId, userId) {
        const rows = await FileService._execute(sqlFindById(), [fileId]);

        if (rows.length === 0) {
            throw new AppError('Arquivo não encontrado.', 404);
        }

        await FileService._execute(sqlSoftDeleteFile(), [userId, fileId]);
    }

    /**
     * Busca um arquivo ativo pelo ID.
     *
     * @param {number} fileId
     * @returns {Promise<Object>} Registro de `_files`.
     * @throws {AppError} 404 se não encontrado ou inativo.
     */
    static async findById(fileId) {
        const rows = await FileService._execute(sqlFindById(), [fileId]);

        if (rows.length === 0) {
            throw new AppError('Arquivo não encontrado.', 404);
        }

        return rows[0];
    }

    /**
     * Retorna o caminho absoluto no disco de um registro de `_files`.
     *
     * @param {Object} fileRecord - Registro retornado por `findById` ou `save`.
     * @returns {string} Caminho absoluto.
     */
    static absolutePath(fileRecord) {
        return path.join(STORAGE_ROOT, fileRecord.file_path);
    }

    // ── Helpers privados ──────────────────────────────────────────────────────

    /**
     * Constrói os caminhos de armazenamento para um arquivo novo.
     *
     * Estrutura: `Storage/{MODULO}/uploads/{YYYY}/{MM}/{DD}/{hash}.{ext}`
     * (mantém compatibilidade com o padrão do PHP)
     *
     * @private
     * @param {string} hash      - Hash SHA-256 do arquivo.
     * @param {string} extension - Extensão normalizada.
     * @param {string} module    - Nome do módulo em maiúsculas.
     * @returns {{ relativePath: string, absolutePath: string, absoluteDir: string }}
     */
    static _buildPaths(hash, extension, module) {
        const now      = new Date();
        const yyyy     = now.getFullYear();
        const mm       = String(now.getMonth() + 1).padStart(2, '0');
        const dd       = String(now.getDate()).padStart(2, '0');

        const subPath      = `storage/uploads/${module}/${yyyy}/${mm}/${dd}`;
        const fileName     = `${hash}.${extension}`;
        const relativePath = `${subPath}/${fileName}`;
        const absoluteDir  = path.join(STORAGE_ROOT, subPath);
        const absolutePath = path.join(absoluteDir, fileName);

        return { relativePath, absolutePath, absoluteDir };
    }

    /**
     * Converte um buffer de imagem (PNG ou JPEG) para WebP.
     *
     * Usa `sharp` para conversão + remoção automática de metadados EXIF/XMP/IPTC.
     * Qualidade padrão: 85 (bom equilíbrio tamanho × fidelidade).
     *
     * @private
     * @param {Buffer} buf - Buffer da imagem original (PNG ou JPEG).
     * @returns {Promise<Buffer>} Buffer da imagem convertida em WebP.
     * @throws {AppError} 500 se `sharp` não estiver instalado ou a conversão falhar.
     */
    static async _convertToWebP(buf) {
        let sharp;
        try {
            sharp = require('sharp');
        } catch {
            throw new AppError(
                'Conversão WebP indisponível — execute "npm install sharp" no servidor.',
                500
            );
        }

        try {
            return await sharp(buf)
                .webp({ quality: 85 })
                .withMetadata(false) // remove EXIF / XMP / IPTC
                .toBuffer();
        } catch (err) {
            throw new AppError(`Falha ao converter imagem para WebP: ${err.message}`, 500);
        }
    }
}

module.exports = { FileService, upload };
