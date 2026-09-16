/**
 * @fileoverview Controller das rotas consumidas pelo player Android.
 *
 * Nenhuma delas usa `req.user` — quem chama é o dispositivo, e o middleware
 * `authenticateDevice` popula `req.device`.
 *
 * @module modules/global/controllers/miepp-device.controller
 */

const { MieppDeviceUseCases } = require('../application/miepp/device/miepp-device.use-cases');
const { MysqlMieppPlayerRepository } = require('../infrastructure/miepp/mysql-miepp-player.repository');
const { MysqlMieppScheduleRepository } = require('../infrastructure/miepp/mysql-miepp-schedule.repository');
const { MysqlMieppPlaylistRepository } = require('../infrastructure/miepp/mysql-miepp-playlist.repository');
const { pairingService, mediaTokenService } = require('../infrastructure/miepp/miepp-services');
const { mieppConfig } = require('../../../config/miepp');
const { respond } = require('../../../utils/respond');

const useCases = new MieppDeviceUseCases({
    playerRepository: new MysqlMieppPlayerRepository(),
    scheduleRepository: new MysqlMieppScheduleRepository(),
    playlistRepository: new MysqlMieppPlaylistRepository(),
    pairingService,
    mediaTokenService,
    config: {
        deviceTokenTtlDays: mieppConfig.deviceTokenTtlDays,
        fallbackPlaylistId: mieppConfig.fallbackPlaylistId,
    },
});

/**
 * Troca o código de pareamento pelo token do dispositivo.
 *
 * Única rota de device sem token prévio. O token vai em texto puro nesta
 * resposta e em nenhum outro lugar — o banco guarda só o SHA-256.
 *
 * @route POST /miepp/device/pair
 */
async function pair(req, res) {
    return respond.created(res, await useCases.pair(req.body.pairing_code));
}

/**
 * Playlist que este player deve tocar agora, já resolvida e com as URLs de
 * mídia assinadas.
 *
 * @route GET /miepp/device/playlist
 */
async function getPlaylist(req, res) {
    return respond.ok(res, await useCases.getPlaylist(req.device));
}

/**
 * Heartbeat.
 *
 * `req.ip` (resolvido pela lista de proxies confiáveis do `app.factory`) é o IP
 * de SAÍDA da loja — igual para todas as telas do mesmo lugar, então não serve
 * para localizar uma tela específica.
 *
 * Por isso o app também informa `local_ip` (o endereço dele na LAN), e é esse
 * que vai para `last_ip`. É dado de diagnóstico, não de autorização: um device
 * que mentisse sobre o próprio IP só atrapalharia quem olha o painel. O IP
 * observado continua gravado no `detail` do log, para conferência.
 *
 * @route POST /miepp/device/heartbeat
 */
async function heartbeat(req, res) {
    return respond.ok(res, await useCases.heartbeat(req.device, req.body, req.ip));
}

/**
 * @route GET /miepp/device/commands/pending
 */
async function pendingCommands(req, res) {
    return respond.ok(res, await useCases.pendingCommands(req.device));
}

/**
 * @route POST /miepp/device/commands/:id/ack
 */
async function ackCommand(req, res) {
    const result = await useCases.ackCommand(req.device, Number(req.params.id), req.body.status);
    return respond.ok(res, result);
}

module.exports = { pair, getPlaylist, heartbeat, pendingCommands, ackCommand };
