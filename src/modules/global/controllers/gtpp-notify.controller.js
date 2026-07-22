/**
 * @fileoverview Controller de notificações GTPP.
 * @module modules/global/controllers/gtpp-notify.controller
 */

'use strict';

const { respond }   = require('../../../utils/respond');
const notifyService = require('../services/gtpp-notify.service');

/**
 * GET /gtpp/notifications
 * Retorna e consome (deleta) todas as notificações pendentes do usuário autenticado.
 */
async function getNotifications(req, res) {
    const notifications = await notifyService.getAndConsumeNotifications(req.user.id);
    return respond.ok(res, notifications);
}

module.exports = { getNotifications };
