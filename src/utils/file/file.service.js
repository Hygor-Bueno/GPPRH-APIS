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
const { sanitizeFilename, validateExtension, reconcileExtension, validateModule } = require('./validators');
const { scanForBinaryThreats, scanPdfContent, scanForCode, checkTextComplexity, checkZipBomb, checkImageDimensions } = require('./scanners');
const { MAX_FILE_BYTES, MAX_VIDEO_BYTES, MAX_REQUEST_BYTES, BUFFER_THRESHOLD_BYTES,
        UPLOAD_TEMP_DIR, MIME_TO_EXT, VIDEO_MIMES } = require('./constants');
const { probeVideoCodec, probeVideoCodecFromFile } = require('./video-codec');
const { decideTranscode } = require('../video/transcode-policy');
const { SQL_ENQUEUE } = require('../../modules/global/repositories/mysql/video-transcode.queries');
const { sqlFindByHash, sqlFindById, sqlInsertFile, sqlSoftDeleteFile } = require('../../modules/global/repositories/mysql/files.queries');

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

/**
 * Enfileirar vídeo para conversão é OPT-IN por variável de ambiente.
 *
 * Desligada (o padrão), nada é inserido em `gt_video_transcode_queue` — então
 * este código sobe com segurança ANTES de a tabela existir. Foi a ordem inversa
 * disso que derrubou os arquivos de todos os módulos em 2026-09-10: código
 * referenciando schema ainda não aplicado.
 *
 * Sequência de ativação: deploy do código → criar a tabela → ligar a flag.
 */
const TRANSCODE_ENABLED = process.env.VIDEO_TRANSCODE_ENABLED === 'true';

/** MIMEs de imagem que recebem strip de metadados EXIF (quando possível). */
const IMAGE_MIMES  = new Set(['image/png', 'image/jpeg', 'image/webp']);
/** MIMEs de texto que recebem scan de código + complexidade. */
const TEXT_MIMES   = new Set([
    'text/plain', 'text/csv', 'text/html', 'text/css', 'application/javascript',
]);
const WEB_MIMES    = new Set(['text/html', 'text/css', 'application/javascript']);
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
 * Diretório dos temporários, resolvido a partir da raiz do projeto. Criado no
 * carregamento do módulo: se não existir, o multer falha todo upload com ENOENT.
 */
const TEMP_DIR = path.resolve(STORAGE_ROOT, UPLOAD_TEMP_DIR);
fs.mkdirSync(TEMP_DIR, { recursive: true });

/**
 * Instância multer pré-configurada. Use `FileService.upload.single('file')`.
 *
 * `diskStorage` e não `memoryStorage`: com o teto de vídeo em 200 MB, manter o
 * upload em RAM derrubaria o worker (`max_memory_restart: "1G"`) antes mesmo de
 * o arquivo terminar de chegar. Em disco, o pico de memória passa a ser o de UM
 * arquivo lido por vez, não a soma da requisição.
 *
 * O temporário vive dentro de `storage/`, o mesmo sistema de arquivos do
 * destino final — assim mover o arquivo é `rename` (instantâneo) e não cópia.
 * Quem apaga o que sobra é o `cleanupUploads`, registrado no `app.factory`.
 *
 * O limite aqui é o MAIOR dos dois (vídeo). O limite por tipo é aplicado depois,
 * no `save()`, quando o conteúdo real já foi identificado — o multer não tem
 * como saber o tipo antes de receber os bytes.
 *
 * @type {import('multer').Multer}
 */
const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, TEMP_DIR),
        filename: (_req, _file, cb) =>
            cb(null, `upload-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`),
    }),
    limits: { fileSize: MAX_VIDEO_BYTES },
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
        if (!file || (!file.buffer && !file.path)) {
            throw new AppError('Nenhum arquivo recebido.', 400);
        }

        // Arquivo grande em disco → fluxo em streaming (só vídeo passa por ali).
        if (file.path && !file.buffer && Number(file.size ?? 0) > BUFFER_THRESHOLD_BYTES) {
            return FileService._saveLarge(file, module, userId);
        }

        // Caso geral: carrega em memória e segue o pipeline de sempre, sem
        // nenhuma mudança de comportamento para imagem, PDF, OOXML e texto.
        const buffered = file.buffer ? file : { ...file, buffer: fs.readFileSync(file.path) };

        return FileService._saveBuffered(buffered, module, userId);
    }

    /**
     * Fluxo original, sobre Buffer. Mantido intacto de propósito: é o caminho de
     * 99% dos uploads e o único coberto pelos scans de zip bomb, código em texto
     * e dimensão de imagem, que trabalham em memória.
     *
     * @private
     */
    static async _saveBuffered(file, module, userId) {
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
            throw new AppError(`Arquivo excede o tamanho máximo permitido de ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`, 400);
        }

        // ── Validação de módulo ───────────────────────────────────────────────
        validateModule(module);

        // ── Camada 1: nome e extensão ─────────────────────────────────────────
        let safeName = sanitizeFilename(file.originalname);
        validateExtension(safeName);
        const claimedExtension = path.extname(safeName).replace('.', '').toLowerCase();

        // ── Camada 2: MIME real por magic bytes ───────────────────────────────
        let mimeType = detect(buf, claimedExtension);

        if (!MIME_TO_EXT[mimeType]) {
            throw new AppError(`Tipo de arquivo não suportado (detectado: ${mimeType}).`, 400);
        }



        // ── Camada 3: ameaças binárias ────────────────────────────────────────
        // Vídeo é exceção deliberada. O scan procura assinaturas de 4 bytes
        // (ELF, Mach-O, MZ+PE) nos primeiros 5 MB; vídeo comprimido é fluxo
        // denso e quase aleatório, então essas sequências aparecem por acaso em
        // torno de 0,4% dos arquivos — recusaria ~1 vídeo legítimo a cada 250,
        // com uma mensagem sobre executável que não ajuda ninguém. A garantia
        // aqui é o contêiner: o arquivo já foi validado por magic bytes e pela
        // marca ISO-BMFF/EBML, e vídeo não é executado por nada no servidor.
        if (!VIDEO_MIMES.has(mimeType)) {
            scanForBinaryThreats(buf, { allowWebScripts: WEB_MIMES.has(mimeType) });
        }

        // ── Camada 4: scans específicos por tipo ──────────────────────────────
        if (mimeType === 'application/pdf') {
            scanPdfContent(buf);
        } else if (TEXT_MIMES.has(mimeType) && !WEB_MIMES.has(mimeType)) {
            scanForCode(buf);
            checkTextComplexity(buf);
        } else if (IMAGE_MIMES.has(mimeType)) {
            checkImageDimensions(buf, mimeType);
        } else if (OOXML_MIMES.has(mimeType)) {
            checkZipBomb(buf);
        }
        // Vídeo não tem scan específico: não há formato de macro/script embutido
        // nos contêineres aceitos, e a validação de marca já rodou na Camada 2.

        // ── Conversão para WebP (imagens PNG e JPEG) ──────────────────────────
        // Scans já rodaram no conteúdo original; a deduplicação e o armazenamento
        // usam o buffer final (já convertido) para máxima economia de espaço.
        if (IMAGE_MIMES.has(mimeType) && mimeType !== 'image/webp') {
            buf      = await FileService._convertToWebP(buf);
            mimeType = 'image/webp';
        }

        // ── Codec do vídeo ────────────────────────────────────────────────────
        // `video/mp4` é o contêiner, não o codec: HEVC e H.264 têm o mesmo MIME e
        // a mesma extensão. Como HEVC não toca no Windows sem o pacote pago da
        // Microsoft, o front precisa saber disso ANTES de montar o player. A
        // sondagem lê a estrutura do arquivo (~0,1 ms mesmo em 50 MB) e nunca
        // lança — codec desconhecido vira NULL e o upload segue.
        const videoCodec = VIDEO_MIMES.has(mimeType)
            ? probeVideoCodec(buf, mimeType).video
            : null;

        // Extensão resolvida após possível conversão
        const extension = MIME_TO_EXT[mimeType]; // 'webp', 'pdf', 'xlsx', etc.

        // Concilia o nome com o conteúdo real. Divergência não recusa mais o
        // upload — o conteúdo já foi validado por magic bytes e pelos scans, e o
        // nome é só rótulo. Corrigir a extensão evita que o usuário baixe
        // "foto.png" que na verdade é WebP e o sistema abra no programa errado.
        const reconciled = reconcileExtension(mimeType, safeName, extension);
        if (reconciled.corrected) {
            console.log(
                `[files] extensão conciliada: ".${reconciled.claimedExtension}" → ".${extension}" ` +
                `(conteúdo real: ${mimeType}) em "${safeName}"`
            );
        }
        safeName = reconciled.name;

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
                videoCodec,
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
        const record = rows[0];

        // Enfileira a conversão. Nunca derruba o upload: o arquivo já está salvo
        // e utilizável, e uma fila indisponível não pode custar a evidência do
        // usuário. Sem conversão ele só fica no formato original.
        const queued = await FileService._enqueueTranscode(record);

        return { ...record, transcode_queued: queued };
    }

    /**
     * Fluxo em streaming para arquivo grande — nunca carrega o conteúdo inteiro.
     *
     * Só vídeo chega aqui: acima de `BUFFER_THRESHOLD_BYTES`, qualquer outro
     * tipo é recusado. Não é limitação técnica, é decisão — PDF ou planilha de
     * 100 MB é quase sempre engano, e os scans desses formatos trabalham em
     * memória.
     *
     * Diferenças em relação ao fluxo bufferizado, todas por não ter o Buffer:
     *   - MIME detectado a partir dos primeiros 64 KB (basta para ISO-BMFF e EBML)
     *   - codec sondado lendo só o box `moov` (ver `probeVideoCodecFromFile`)
     *   - hash SHA-256 calculado em streaming
     *   - arquivo MOVIDO para o destino, em vez de reescrito a partir do Buffer
     *
     * O scan de ameaça binária continua não se aplicando a vídeo, exatamente
     * como no fluxo bufferizado — pelo mesmo motivo documentado lá.
     *
     * @private
     * @param {Express.Multer.File} file - Com `.path`, sem `.buffer`.
     * @returns {Promise<Object>}
     */
    static async _saveLarge(file, module, userId) {
        const size = Number(file.size ?? fs.statSync(file.path).size);

        validateModule(module);

        let safeName = sanitizeFilename(file.originalname);
        validateExtension(safeName);

        // ── MIME pelos primeiros 64 KB ────────────────────────────────────────
        const head = Buffer.alloc(Math.min(64 * 1024, size));
        const fd   = fs.openSync(file.path, 'r');
        try { fs.readSync(fd, head, 0, head.length, 0); }
        finally { fs.closeSync(fd); }

        const mimeType = detect(head);

        if (!VIDEO_MIMES.has(mimeType)) {
            throw new AppError(
                `Arquivos acima de ${Math.round(BUFFER_THRESHOLD_BYTES / 1048576)} MB só são aceitos em vídeo ` +
                `(este é ${mimeType}).`,
                400
            );
        }
        if (size > MAX_VIDEO_BYTES) {
            throw new AppError(
                `Vídeo excede o tamanho máximo permitido de ${Math.round(MAX_VIDEO_BYTES / 1048576)} MB.`,
                400
            );
        }

        const extension  = MIME_TO_EXT[mimeType];
        const reconciled = reconcileExtension(mimeType, safeName, extension);
        if (reconciled.corrected) {
            console.log(
                `[files] extensão conciliada: ".${reconciled.claimedExtension}" → ".${extension}" ` +
                `(conteúdo real: ${mimeType}) em "${safeName}"`
            );
        }
        safeName = reconciled.name;

        const videoCodec = probeVideoCodecFromFile(file.path, mimeType).video;

        // ── Deduplicação ──────────────────────────────────────────────────────
        const fileHash = await FileService._hashFile(file.path);
        const existing = await FileService._execute(sqlFindByHash(), [fileHash]);

        if (existing.length > 0) {
            return { ...existing[0], transcode_queued: false };
        }

        // ── Move para o storage definitivo ────────────────────────────────────
        const { relativePath, absolutePath, absoluteDir } =
            FileService._buildPaths(fileHash, extension, module);

        fs.mkdirSync(absoluteDir, { recursive: true });
        FileService._moveFile(file.path, absolutePath);
        fs.chmodSync(absolutePath, 0o644);

        // ── Registra em `_files` ──────────────────────────────────────────────
        let insertResult;
        try {
            insertResult = await FileService._execute(sqlInsertFile(), [
                relativePath, safeName, extension, mimeType, size, fileHash, videoCodec, userId, userId,
            ]);
        } catch (dbErr) {
            // Sem registro no banco o arquivo é órfão em disco — remove.
            try { fs.unlinkSync(absolutePath); } catch { /* ignora */ }
            throw new AppError(`Erro ao registrar arquivo no banco: ${dbErr.message}`, 500);
        }

        const rows   = await FileService._execute(sqlFindById(), [insertResult.insertId]);
        const record = rows[0];
        const queued = await FileService._enqueueTranscode(record);

        console.log(`[files] vídeo grande gravado por streaming: ${(size / 1048576).toFixed(1)} MB, codec=${videoCodec || '?'}`);

        return { ...record, transcode_queued: queued };
    }

    /**
     * SHA-256 em streaming — o arquivo nunca precisa caber inteiro em RAM.
     *
     * @private
     * @param {string} filePath
     * @returns {Promise<string>}
     */
    static _hashFile(filePath) {
        return new Promise((resolve, reject) => {
            const hash   = crypto.createHash('sha256');
            const stream = fs.createReadStream(filePath);
            stream.on('error', reject);
            stream.on('data', chunk => hash.update(chunk));
            stream.on('end', () => resolve(hash.digest('hex')));
        });
    }

    /**
     * Move o temporário para o destino.
     *
     * `rename` é instantâneo, mas só funciona dentro do mesmo sistema de
     * arquivos. O `UPLOAD_TEMP_DIR` foi posto dentro de `storage/` justamente
     * para isso — o fallback de cópia existe para quem sobrescrever a variável
     * apontando para outro dispositivo (o erro é `EXDEV`).
     *
     * @private
     */
    static _moveFile(from, to) {
        try {
            fs.renameSync(from, to);
        } catch (err) {
            if (err.code !== 'EXDEV') throw err;
            fs.copyFileSync(from, to);
            fs.unlinkSync(from);
        }
    }

    /**
     * Insere o arquivo na fila de conversão, se houver motivo para converter.
     *
     * @private
     * @param {Object} record - Registro de `_files` recém-criado.
     * @returns {Promise<boolean>} `true` se entrou na fila.
     */
    static async _enqueueTranscode(record) {
        if (!TRANSCODE_ENABLED) return false;

        const { shouldTranscode, reason } = decideTranscode(record);
        if (!shouldTranscode) return false;

        try {
            await FileService._execute(SQL_ENQUEUE, [record.id, record.video_codec ?? null, record.file_size]);
            console.log(`[files] video file_id=${record.id} enfileirado para conversão (${reason})`);
            return true;
        } catch (err) {
            console.error('[files] Falha ao enfileirar conversão:', err.message);
            return false;
        }
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

    /**
     * Busca um arquivo ativo pelo nome físico salvo em disco (`{hash}.{ext}`).
     *
     * Os arquivos são nomeados pelo hash SHA-256 do conteúdo e organizados em
     * subpastas por data (`Storage/{MODULO}/uploads/{YYYY}/{MM}/{DD}/{hash}.{ext}`),
     * então o hash sozinho já identifica o registro em `_files` sem precisar
     * conhecer módulo ou data.
     *
     * @param {string} filename - Nome do arquivo (ex: `<hash>.webp`).
     * @returns {Promise<Object>} Registro de `_files`.
     * @throws {AppError} 404 se não encontrado ou inativo.
     */
    static async findByFilename(filename) {
        const hash = path.parse(filename).name;
        const rows = await FileService._execute(sqlFindByHash(), [hash]);

        if (rows.length === 0) {
            throw new AppError('Arquivo não encontrado.', 404);
        }

        return rows[0];
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
