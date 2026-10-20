/**
 * @fileoverview Controller das notificações da REPP (sino do usuário).
 *
 * @module modules/global/controllers/repp-notification.controller
 */

const { ReppNotificationUseCases } = require('../application/repp/notification/repp-notification.use-cases');
const { MysqlReppNotificationRepository } = require('../infrastructure/repp/mysql-repp-notification.repository');
const { respond } = require('../../../utils/respond');

const useCases = new ReppNotificationUseCases({
    notificationRepository: new MysqlReppNotificationRepository(),
});

/** @route GET /spaces/notifications — não lidas; não apaga nem marca. */
async function listUnread(req, res) {
    return respond.ok(res, await useCases.listUnread(req.user));
}

/** @route PATCH /spaces/notifications/read  body: `{ ids: number[] }` */
async function markRead(req, res) {
    return respond.ok(res, await useCases.markRead({ ids: req.body?.ids, user: req.user }));
}

module.exports = { listUnread, markRead };
