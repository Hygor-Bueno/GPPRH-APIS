/**
 * @fileoverview Controller dos relatórios de exibição (proof-of-play).
 *
 * Somente leitura. Quem escreve é o dispositivo, pela rota
 * `POST /miepp/device/plays` (ver `miepp-device.controller`) — não existe rota
 * de painel que insira exibição, pela mesma razão da trilha de auditoria: um
 * número de audiência que a API aceita por fora deixa de valer como medida.
 *
 * @module modules/global/controllers/miepp-play.controller
 */

const { MieppPlayUseCases } = require('../application/miepp/play/miepp-play.use-cases');
const { MysqlMieppPlayRepository } = require('../infrastructure/miepp/mysql-miepp-play.repository');
const { MysqlMieppMediaRepository } = require('../infrastructure/miepp/mysql-miepp-media.repository');
const { MysqlMieppPlayerRepository } = require('../infrastructure/miepp/mysql-miepp-player.repository');
const { respond } = require('../../../utils/respond');

const useCases = new MieppPlayUseCases({
    repository: new MysqlMieppPlayRepository(),
    mediaRepository: new MysqlMieppMediaRepository(),
    playerRepository: new MysqlMieppPlayerRepository(),
});

/**
 * Ranking: quantas vezes cada mídia foi exibida no período.
 *
 * @route GET /miepp/reports/media-plays?from=2026-09-01&to=2026-09-21&location_id=3
 */
async function listMediaPlays(req, res) {
    return respond.ok(res, await useCases.listMediaPlays(req.query));
}

/**
 * Uma mídia, aberta por local, por tela e por dia.
 *
 * @route GET /miepp/media/:id/plays?from=2026-09-01&to=2026-09-21
 */
async function mediaPlayReport(req, res) {
    return respond.ok(res, await useCases.mediaPlayReport(req.params.id, req.query));
}

/**
 * Exibições cruas de uma tela — evidência, sujeita à purga do evento cru.
 *
 * @route GET /miepp/players/:id/plays?from=2026-09-20&to=2026-09-21
 */
async function listPlayerPlays(req, res) {
    return respond.ok(res, await useCases.listPlayerPlays(req.params.id, req.query));
}

module.exports = { listMediaPlays, mediaPlayReport, listPlayerPlays };
