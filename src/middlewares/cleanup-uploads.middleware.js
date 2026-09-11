/**
 * @fileoverview Remove os arquivos temporários do multer ao fim da requisição.
 *
 * Com `memoryStorage` não existia lixo: o upload vivia em RAM e o garbage
 * collector resolvia. Com `diskStorage`, cada upload deixa um arquivo em
 * `UPLOAD_TEMP_DIR`, e o multer **não** limpa nada sozinho — nem quando a rota
 * dá erro, nem quando a validação recusa o arquivo, nem quando o cliente
 * desiste no meio.
 *
 * Sem isto, cada upload recusado deixaria um arquivo órfão, e o servidor tem
 * 31 GB. Um teto de 200 MB por vídeo transforma isso em problema rápido.
 *
 * Fica registrado ANTES das rotas, mas o trabalho acontece depois: o listener é
 * pendurado em `finish` (resposta enviada) e `close` (conexão caiu antes disso,
 * que é justamente o caso do upload grande abortado).
 *
 * O caminho feliz não depende deste middleware — quando o `FileService` move o
 * temporário para o storage definitivo, não sobra nada para apagar e o
 * `unlink` cai no ENOENT, que é ignorado.
 *
 * @module middlewares/cleanup-uploads.middleware
 */

'use strict';

const fs = require('fs');

/**
 * Achata as três formas que o multer usa para expor arquivos:
 * `.single()` → `req.file`; `.array()` → `req.files` (array);
 * `.fields()` → `req.files` (objeto de arrays).
 *
 * @param {import('express').Request} req
 * @returns {string[]} Caminhos temporários, sem repetição.
 */
function collectTempPaths(req) {
    const files = [];

    if (req.file) files.push(req.file);

    if (Array.isArray(req.files)) {
        files.push(...req.files);
    } else if (req.files && typeof req.files === 'object') {
        for (const group of Object.values(req.files)) {
            if (Array.isArray(group)) files.push(...group);
        }
    }

    return [...new Set(files.map(f => f?.path).filter(Boolean))];
}

/**
 * @type {import('express').RequestHandler}
 */
function cleanupUploads(req, res, next) {
    let done = false;

    const purge = () => {
        if (done) return;      // `finish` e `close` podem disparar os dois
        done = true;

        for (const tempPath of collectTempPaths(req)) {
            fs.unlink(tempPath, err => {
                // ENOENT é o caso normal: o arquivo já virou definitivo.
                if (err && err.code !== 'ENOENT') {
                    console.error(`[uploads] Temporário não removido (${tempPath}):`, err.message);
                }
            });
        }
    };

    res.on('finish', purge);
    res.on('close', purge);

    next();
}

module.exports = { cleanupUploads, collectTempPaths };
