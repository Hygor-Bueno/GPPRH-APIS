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
 * Quanto tempo o navegador pode reusar o arquivo sem perguntar de novo.
 *
 * Esta rota é o maior consumidor de requisições da API: as telas de
 * colaboradores e o GTPP buscam cada foto por aqui, uma requisição por foto. Sem
 * cache, o `res.sendFile` manda `Cache-Control: public, max-age=0`, e o
 * navegador **revalida a cada exibição** — mesmo o 304, que não transfere bytes,
 * é uma requisição que conta no rate limit. Foi o que estourava a cota de quem
 * navegava por listas com foto (relato de 24/08/2026).
 *
 * É seguro cachear porque o conteúdo é IMUTÁVEL para um dado `fileId`: o nome no
 * disco é o hash do conteúdo (ver `file.service`), então trocar a foto de alguém
 * grava outra linha em `_files` e o front passa a pedir outro id. Não existe
 * cenário em que o mesmo id devolva bytes diferentes.
 *
 * `private`, e não `public`: o arquivo exige sessão, e proxy compartilhado não
 * pode guardar cópia.
 *
 * A contrapartida é o soft-delete: quem já tem o arquivo em cache continua
 * conseguindo exibi-lo por até uma hora depois da remoção. Uma hora é o
 * suficiente para cobrir uma sessão de trabalho inteira sem repetir requisição,
 * e curto o bastante para a remoção não ficar pendurada o dia todo. Se um dia
 * for preciso remoção imediata, o caminho é invalidar por id novo — não baixar
 * este número.
 */
const FILE_CACHE_SECONDS = 3600;

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

    // `cacheControl: false` desliga o header que o `send` escreveria por conta
    // própria — sem isso ele sobrescreve o nosso com `public, max-age=0`. O
    // ETag continua sendo gerado, então depois da hora a revalidação ainda é
    // barata (304 sem corpo).
    res.set('Cache-Control', `private, max-age=${FILE_CACHE_SECONDS}`);

    res.sendFile(absolutePath, { cacheControl: false }, err => {
        if (err) {
            console.error(`[files] File missing on disk: ${absolutePath}`, err.message);
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
