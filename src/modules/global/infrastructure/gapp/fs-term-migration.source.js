/**
 * @fileoverview Pasta de origem dos termos do sistema legado (somente leitura).
 *
 * A pasta é montada no container da API (bind mount `:ro` no docker-compose) e
 * apontada por `GAPP_TERM_MIGRATION_SOURCE_DIR`. Este adapter só LISTA e LÊ:
 * nada aqui escreve, move ou apaga arquivo do legado.
 *
 * `source_path` gravado na tabela de controle é RELATIVO à raiz (com `/`),
 * e todo acesso passa por `_resolve`, que recusa sair da raiz — o caminho vem
 * do banco, mas não custa nada não confiar nele.
 *
 * @module modules/global/infrastructure/gapp/fs-term-migration.source
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { AppError } = require('../../../../errors/app.error');
const { sanitizeFilename } = require('../../../../utils/file/validators');
const { TermMigrationSourcePort } = require('../../application/gapp/term-migration/ports/term-migration.ports');

const ENV_VAR = 'GAPP_TERM_MIGRATION_SOURCE_DIR';
const MAX_DEPTH = 5;
/** Lixo de sistema que aparece em pasta copiada do Windows. */
const SKIP_NAMES = new Set(['thumbs.db', 'desktop.ini']);

class FsTermMigrationSource extends TermMigrationSourcePort {
    /** @param {{ root?: string }} [options] - `root` explícito (testes); padrão: a variável de ambiente. */
    constructor({ root } = {}) {
        super();
        const configured = root ?? process.env[ENV_VAR];
        this.root = configured && configured.trim() ? path.resolve(configured.trim()) : null;
    }

    describe() {
        return { configured: Boolean(this.root), env: ENV_VAR, root: this.root };
    }

    /** @private */
    _assertReady() {
        if (!this.root) {
            throw new AppError(`Pasta de origem não configurada (${ENV_VAR}).`, 503, { code: 'TERM_MIGRATION_SOURCE_NOT_CONFIGURED' });
        }
        let stat;
        try { stat = fs.statSync(this.root); } catch { stat = null; }
        if (!stat?.isDirectory()) {
            throw new AppError('Pasta de origem dos termos indisponível (não montada ou inexistente).', 503, { code: 'TERM_MIGRATION_SOURCE_UNAVAILABLE' });
        }
    }

    /** @private */
    _resolve(relativePath) {
        const absolute = path.resolve(this.root, String(relativePath));
        const rel = path.relative(this.root, absolute);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
            throw new AppError('Caminho de origem inválido.', 400, { code: 'TERM_MIGRATION_INVALID_PATH' });
        }
        return absolute;
    }

    /**
     * Todos os arquivos da pasta (e subpastas até `MAX_DEPTH`), em ordem estável.
     * @returns {Promise<{ relativePath: string, fileName: string, size: number, modifiedAt: Date }[]>}
     */
    async list() {
        this._assertReady();
        const files = [];

        const walk = async (dir, depth) => {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.') || SKIP_NAMES.has(entry.name.toLowerCase())) continue;
                const absolute = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (depth < MAX_DEPTH) await walk(absolute, depth + 1);
                    continue;
                }
                if (!entry.isFile()) continue; // link simbólico, socket... fora
                const stat = await fs.promises.stat(absolute);
                files.push({
                    relativePath: path.relative(this.root, absolute).split(path.sep).join('/'),
                    fileName: entry.name,
                    size: stat.size,
                    modifiedAt: stat.mtime,
                });
            }
        };

        await walk(this.root, 0);
        return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    }

    /**
     * Conteúdo de um arquivo, já no formato que o `FileService.save` espera
     * (o mesmo `req.file` do multer em memória), mais as chaves usadas para
     * achar um vínculo já existente.
     *
     * @returns {Promise<{ file: object, sha256: string, fileNames: string[] }>}
     * @throws {AppError} 404 `TERM_MIGRATION_SOURCE_FILE_MISSING`
     */
    async read(relativePath) {
        this._assertReady();
        const absolute = this._resolve(relativePath);

        let buffer;
        try {
            buffer = await fs.promises.readFile(absolute);
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw new AppError('Arquivo de origem não encontrado na pasta do legado.', 404, { code: 'TERM_MIGRATION_SOURCE_FILE_MISSING' });
            }
            throw new AppError(`Não foi possível ler o arquivo de origem: ${error.message}`, 500, { code: 'TERM_MIGRATION_SOURCE_READ_ERROR' });
        }

        const originalname = path.basename(absolute);
        return {
            file: { originalname, buffer, size: buffer.length, mimetype: 'application/octet-stream' },
            sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
            fileNames: [...new Set([originalname, sanitizeFilename(originalname)])],
        };
    }

    async exists(relativePath) {
        this._assertReady();
        try {
            return (await fs.promises.stat(this._resolve(relativePath))).isFile();
        } catch {
            return false;
        }
    }
}

module.exports = { FsTermMigrationSource, ENV_VAR };
