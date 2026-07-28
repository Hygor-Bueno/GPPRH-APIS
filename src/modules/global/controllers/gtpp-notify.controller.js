/**
 * @fileoverview Controller de notificações GTPP.
 * @module modules/global/controllers/gtpp-notify.controller
 */

'use strict';

const { respond } = require('../../../utils/respond');
const { GtppNotifyUseCases } = require('../application/gtpp/notify/gtpp-notify.use-cases');
const { MysqlNotifyRepository } = require('../infrastructure/gtpp/mysql-notify.repository');

const useCases = new GtppNotifyUseCases({ repository: new MysqlNotifyRepository() });

/**
 * GET /gtpp/notifications
 * Retorna e consome (deleta) todas as notificações pendentes do usuário autenticado.
 */
async function getNotifications(req, res) {
    const notifications = await useCases.getAndConsumeNotifications(req.user.id);
    return respond.ok(res, notifications);
}

module.exports = { getNotifications };
