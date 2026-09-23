/**
 * @fileoverview Controller de Arquivos — Serving e soft-delete.
 *
 * @route GET  /global/files/:fileId  — Serve o arquivo pelo ID (auth obrigatória)
 * @route GET  /global/files/:fileId/poster — Quadro de capa do vídeo (auth obrigatória)
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
 * Códigos que significam "o cliente foi embora", e não "o arquivo tem problema".
 *
 * `ECONNABORTED` é o que o `send` reporta quando a requisição é abortada;
 * `EPIPE` e `ECANCELED` aparecem quando o socket fecha no meio da escrita.
 */
const CLIENT_GAVE_UP = new Set([
    'ECONNABORTED',
    'EPIPE',
    'ECANCELED',
    'ERR_STREAM_PREMATURE_CLOSE',
]);

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
        if (!err) return;

        // Desistência do cliente NÃO é falha do servidor, e aqui é o caso mais
        // comum: o navegador monta a miniatura de um vídeo pedindo o Range do
        // primeiro quadro e corta a conexão assim que o desenha. Tratar isso
        // como arquivo ausente encheu o log de 239 alarmes falsos numa semana
        // — todos `.mp4`, todos com o arquivo intacto no disco, e todos
        // escondendo as falhas de verdade no meio.
        //
        // `headersSent` cobre o resto: depois do primeiro byte não há resposta
        // a dar, e tentar trocaria um erro de transporte por um
        // ERR_HTTP_HEADERS_SENT em cima dele.
        if (CLIENT_GAVE_UP.has(err.code) || res.headersSent) return;

        console.error(`[files] Falha ao servir ${absolutePath}:`, err.message);
        res.status(404).json({ error: true, message: 'Arquivo não encontrado.' });
    });
}

/**
 * Serve o quadro de capa de um vídeo.
 *
 * Existe para tirar a miniatura de vídeo do caminho do streaming. Antes disso,
 * o painel desenhava a miniatura pedindo um Range do próprio `.mp4`: cada card
 * abria uma conexão que atravessava Apache → Node → disco e era cortada assim
 * que o quadro aparecia. Com dezenas de mídias por página, os processos de
 * proxy do Apache ficavam presos segurando vídeo e qualquer requisição nova
 * levava 502 (incidente de 18/09/2026).
 *
 * A capa é um JPEG de poucos KB servido como imagem comum — sem Range, sem
 * conexão longa, e com o mesmo cache de uma hora do arquivo original, que é
 * seguro pelo mesmo motivo: o conteúdo de um `fileId` nunca muda.
 *
 * Quem gera é o worker `video-transcoder`, em varredura. Vídeo recém-enviado
 * pode não ter capa ainda — daí o 404 explícito, que o painel trata caindo no
 * ícone do tipo em vez de esperar.
 *
 * @route GET /files/:fileId/poster
 * @param {import('express').Request}  req - `params.fileId`.
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function servePoster(req, res) {
    const fileId = parseInt(req.params.fileId, 10);
    const record = await FileService.findById(fileId);

    if (!record.poster_path) {
        return res.status(404).json({ error: true, message: 'Capa ainda não gerada.' });
    }

    // A capa mora sob a mesma raiz de armazenamento do vídeo — só muda o
    // caminho relativo, então o resolvedor de `_files` serve para as duas.
    const absolutePath = FileService.absolutePath({ file_path: record.poster_path });

    res.set('Cache-Control', `private, max-age=${FILE_CACHE_SECONDS}`);

    res.sendFile(absolutePath, { cacheControl: false }, err => {
        if (!err) return;
        if (CLIENT_GAVE_UP.has(err.code) || res.headersSent) return;

        console.error(`[files] Falha ao servir capa ${absolutePath}:`, err.message);
        res.status(404).json({ error: true, message: 'Capa não encontrada.' });
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

module.exports = { serveFile, servePoster, deleteFile };
