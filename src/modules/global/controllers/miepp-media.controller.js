/**
 * @fileoverview Controller de mídia do miepp — CRUD e entrega do binário.
 *
 * @module modules/global/controllers/miepp-media.controller
 */

const { MieppMediaUseCases } = require('../application/miepp/media/miepp-media.use-cases');
const { MysqlMieppMediaRepository } = require('../infrastructure/miepp/mysql-miepp-media.repository');
const { mediaStorage, mediaTokenService } = require('../infrastructure/miepp/miepp-services');
const { MediaType } = require('../domain/miepp/miepp.enums');
const { AppError } = require('../../../errors/app.error');
const { respond } = require('../../../utils/respond');

const repository = new MysqlMieppMediaRepository();

const useCases = new MieppMediaUseCases({
    repository,
    storage: mediaStorage,
});

/**
 * Quanto tempo o player pode reusar o arquivo sem perguntar de novo.
 *
 * Mesma lógica do `files.controller` do global: o conteúdo de um dado `uuid` é
 * imutável — trocar o arquivo é cadastrar outra mídia, com outro uuid. Sem
 * cache, cada tela rebaixaria o mesmo vídeo a cada volta do carrossel.
 *
 * `private` porque a URL é assinada para um player específico e não pode ser
 * guardada por proxy compartilhado.
 */
const MEDIA_CACHE_SECONDS = 6 * 3600;

async function list(req, res) {
    return respond.ok(res, await useCases.list(req.query));
}

async function getById(req, res) {
    return respond.ok(res, await useCases.getById(Number(req.params.id)));
}

async function create(req, res) {
    const result = await useCases.create(req.body, req.file, req.user);
    return respond.created(res, result);
}

async function update(req, res) {
    return respond.ok(res, await useCases.update(Number(req.params.id), req.body));
}

async function remove(req, res) {
    return respond.ok(res, await useCases.remove(Number(req.params.id)));
}

/**
 * Serve o binário da mídia para o player.
 *
 * Esta é a única rota de conteúdo sem sessão de usuário e sem token de device:
 * a autorização é a assinatura na query (`?t=`), emitida em
 * `GET /miepp/device/playlist` e válida por poucas horas. O player Android
 * baixa o arquivo com um cliente HTTP simples, que não carrega o header de
 * autenticação do resto das chamadas.
 *
 * Qualquer falha responde 404 genérico — inclusive assinatura inválida. Um 401
 * distinto confirmaria que o uuid existe, e os uuids aparecem no JSON da
 * playlist de qualquer tela pareada.
 *
 * @route GET /miepp/media/:uuid/file?t=<token>&p=<playerId>
 */
async function serveFile(req, res) {
    const notFound = () => new AppError('Mídia não encontrada.', 404);

    const { uuid } = req.params;
    const token = req.query.t;
    const playerId = req.query.p;

    if (!mediaTokenService.verify(uuid, playerId, token)) {
        throw notFound();
    }

    const media = await repository.findByUuid(uuid);
    if (!media) throw notFound();

    // `weburl` não tem binário: o player abre a URL direto e nunca deveria
    // chegar aqui. Responder 404 evita transformar a rota em proxy aberto.
    if (media.type === MediaType.WEBURL || !media.file_id) {
        throw notFound();
    }

    const file = await mediaStorage.resolve(media.file_id);

    res.setHeader('Cache-Control', `private, max-age=${MEDIA_CACHE_SECONDS}`);
    if (file.mimeType) res.type(file.mimeType);

    return res.sendFile(file.absolutePath, { cacheControl: false }, (error) => {
        if (error && !res.headersSent) {
            res.status(404).json({ error: true, message: 'Mídia não encontrada.' });
        }
    });
}

module.exports = { list, getById, create, update, remove, serveFile, MEDIA_CACHE_SECONDS };
