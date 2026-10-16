/**
 * @fileoverview AFD bruto de cada coleta, em disco, byte a byte.
 *
 * Não usa o `FileService`, de propósito: ele deduplica por hash (duas coletas
 * idênticas virariam um arquivo só), varre texto em busca de "código" e pode
 * recusar o conteúdo. Para registro fiscal, o requisito é o contrário —
 * guardar EXATAMENTE o que o equipamento enviou, uma vez por coleta.
 *
 * - grava o `Buffer` da resposta, sem decodificar e sem converter quebra de
 *   linha (o ETL Python gravava o texto já decodificado, e o AFD de 28/08 saiu
 *   com CR duplicado no Windows);
 * - `flag: 'wx'` — nunca sobrescreve um arquivo existente;
 * - `mode: 0o444` — somente leitura;
 * - SHA-256 registrado na coleta e conferido a cada download.
 *
 * Layout: `<CPPP_STORAGE_ROOT>/afd/<CODE>/<AAAA>/<MM>/afd_<CODE>_run<id>_<AAAAMMDD_HHMMSS>.txt`
 *
 * @module modules/global/infrastructure/cppp/fs-cppp-raw-afd.storage
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { CpppRawAfdStoragePort } = require('../../application/cppp/ports/cppp-external.ports');
const { AppError } = require('../../../../errors/app.error');

const DEVICE_CODE_RE = /^[A-Z0-9_]{2,20}$/;

const pad = (value) => String(value).padStart(2, '0');

class FsCpppRawAfdStorage extends CpppRawAfdStoragePort {
    /**
     * @param {{root: string, now?: () => Date}} deps
     */
    constructor({ root, now = () => new Date() }) {
        super();
        this.root = path.resolve(root);
        this.now = now;
    }

    async save({ deviceCode, runId, buffer }) {
        if (!DEVICE_CODE_RE.test(deviceCode)) throw new AppError(`Código de relógio inválido: '${deviceCode}'.`, 500);
        if (!Buffer.isBuffer(buffer)) throw new AppError('AFD recebido não é binário.', 500);

        const now = this.now();
        const yyyy = String(now.getFullYear());
        const mm = pad(now.getMonth() + 1);
        const stamp = `${yyyy}${mm}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

        const relativePath = path.posix.join('afd', deviceCode, yyyy, mm, `afd_${deviceCode}_run${runId}_${stamp}.txt`);
        const absolutePath = path.join(this.root, ...relativePath.split('/'));

        try {
            await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
            await fs.promises.writeFile(absolutePath, buffer, { flag: 'wx', mode: 0o444 });
        } catch (error) {
            throw new AppError(
                `Não foi possível gravar o AFD bruto em ${this.root} (${error.code || error.message}). Nada foi carregado.`,
                500,
                { code: 'CPPP_RAW_STORAGE', details: error },
            );
        }

        return {
            relativePath,
            sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
            bytes: buffer.length,
        };
    }

    async resolve(relativePath, expectedSha256) {
        const absolutePath = path.resolve(this.root, relativePath);
        if (!absolutePath.startsWith(this.root + path.sep)) {
            throw new AppError('Caminho de AFD fora do armazenamento.', 400);
        }

        let content;
        try {
            content = await fs.promises.readFile(absolutePath);
        } catch {
            throw new AppError('AFD bruto não encontrado no armazenamento.', 404);
        }

        const sha256 = crypto.createHash('sha256').update(content).digest('hex');
        if (expectedSha256 && sha256 !== expectedSha256) {
            // Arquivo fiscal que não bate com o hash da coleta: não entregar
            // como se fosse o original.
            throw new AppError('O AFD bruto em disco não confere com o hash registrado na coleta.', 500, {
                code: 'CPPP_RAW_HASH_MISMATCH',
            });
        }

        return { absolutePath, fileName: path.basename(absolutePath) };
    }
}

module.exports = { FsCpppRawAfdStorage };
