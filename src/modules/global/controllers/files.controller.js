/**
 * @fileoverview Controller de Arquivos — Serving e soft-delete.
 *
 * @route GET  /global/files/:fileId  — Serve o arquivo pelo ID (auth obrigatória)
 * @route DELETE /global/files/:fileId — Soft-delete (status = 0)
 *
 * @module modules/global/controllers/files.controller
 */

const { FileService } = require('../../../utils/file/file.service');
const { respond }     = require('../../../utils/respond');

/**
 * Serve um arquivo de `_files` pelo ID.
 *
 * Verifica se o arquivo existe, está ativo (status = 1) e envia o conteúdo.
 * A autenticação é garantida pelo `authMiddleware` na rota.
 *
 * @route GET /files/:fileId
 * @param {import('express').Request}  req - `params.fileId`.
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function serveFile(req, res) {
    const fileId = parseInt(req.params.fileId, 10);
    const record = await FileService.findById(fileId);

    const absolutePath = FileService.absolutePath(record);

    res.sendFile(absolutePath, err => {
        if (err) {
            console.error(`[files] Arquivo não encontrado em disco: ${absolutePath}`, err.message);
            res.status(404).json({ error: true, message: 'Arquivo não encontrado.' });
        }
    });
}

/**
 * Soft-delete de um arquivo (marca `status = 0` em `_files`).
 *
 * O arquivo físico e o registro são preservados. Outras entidades
 * que referenciam o mesmo `file_id` continuam funcionando.
 *
 * @route DELETE /files/:fileId
 * @param {import('express').Request}  req - `params.fileId`.
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function deleteFile(req, res) {
    const fileId = parseInt(req.params.fileId, 10);
    await FileService.softDelete(fileId, req.user.id);
    return respond.ok(res, { message: 'Arquivo removido com sucesso.' });
}

module.exports = { serveFile, deleteFile };
