/**
 * @fileoverview Controller das rotas consumidas pelo player Android.
 *
 * Nenhuma delas usa `req.user` — quem chama é o dispositivo, e o middleware
 * `authenticateDevice` popula `req.device`.
 *
 * @module modules/global/controllers/meipp-device.controller
 */

const { MeippDeviceUseCases } = require('../application/meipp/device/meipp-device.use-cases');
const { MysqlMeippPlayerRepository } = require('../infrastructure/meipp/mysql-meipp-player.repository');
const { MysqlMeippScheduleRepository } = require('../infrastructure/meipp/mysql-meipp-schedule.repository');
const { MysqlMeippPlaylistRepository } = require('../infrastructure/meipp/mysql-meipp-playlist.repository');
const { pairingService, mediaTokenService } = require('../infrastructure/meipp/meipp-services');
const { meippConfig } = require('../../../config/meipp');
const { respond } = require('../../../utils/respond');

const useCases = new MeippDeviceUseCases({
    playerRepository: new MysqlMeippPlayerRepository(),
    scheduleRepository: new MysqlMeippScheduleRepository(),
    playlistRepository: new MysqlMeippPlaylistRepository(),
    pairingService,
    mediaTokenService,
    config: {
        deviceTokenTtlDays: meippConfig.deviceTokenTtlDays,
        fallbackPlaylistId: meippConfig.fallbackPlaylistId,
    },
});

/**
 * Troca o código de pareamento pelo token do dispositivo.
 *
 * Única rota de device sem token prévio. O token vai em texto puro nesta
 * resposta e em nenhum outro lugar — o banco guarda só o SHA-256.
 *
 * @route POST /meipp/device/pair
 */
async function pair(req, res) {
    return respond.created(res, await useCases.pair(req.body.pairing_code));
}

/**
 * Playlist que este player deve tocar agora, já resolvida e com as URLs de
 * mídia assinadas.
 *
 * @route GET /meipp/device/playlist
 */
async function getPlaylist(req, res) {
    return respond.ok(res, await useCases.getPlaylist(req.device));
}

/**
 * Heartbeat.
 *
 * O IP vem de `req.ip` (resolvido pelo `trust proxy`), nunca do corpo: um
 * dispositivo não deve poder declarar de onde está falando.
 *
 * @route POST /meipp/device/heartbeat
 */
async function heartbeat(req, res) {
    return respond.ok(res, await useCases.heartbeat(req.device, req.body, req.ip));
}

/**
 * @route GET /meipp/device/commands/pending
 */
async function pendingCommands(req, res) {
    return respond.ok(res, await useCases.pendingCommands(req.device));
}

/**
 * @route POST /meipp/device/commands/:id/ack
 */
async function ackCommand(req, res) {
    const result = await useCases.ackCommand(req.device, Number(req.params.id), req.body.status);
    return respond.ok(res, result);
}

module.exports = { pair, getPlaylist, heartbeat, pendingCommands, ackCommand };
