/**
 * @fileoverview Serviço de notificações GTPP.
 *
 * As notificações são consumidas (deletadas) no momento da leitura,
 * igual ao comportamento do PHP original.
 *
 * @module modules/global/services/gtpp-notify.service
 */

'use strict';

const { poolGlobal } = require('../../../config/mysql');
const { AppError }   = require('../../../errors/app.error');
const {
    SQL_GET_NOTIFICATIONS,
    SQL_INSERT_NOTIFICATION,
    SQL_DELETE_NOTIFICATION,
    SQL_DELETE_ALL_NOTIFICATIONS,
} = require('../repositories/mysql/gtpp.repository');

/**
 * Retorna e deleta todas as notificações pendentes do usuário.
 * O campo `object` é automaticamente parseado de JSON.
 * @param {number} userId
 */
async function getAndConsumeNotifications(userId) {
    const conn = await poolGlobal.getConnection();
    try {
        await conn.beginTransaction();

        // SELECT + DELETE atômicos — evita race condition se chamado simultaneamente
        const [rows] = await conn.execute(SQL_GET_NOTIFICATIONS, [userId]);
        await conn.execute(SQL_DELETE_ALL_NOTIFICATIONS, [userId]);

        await conn.commit();

        rows.forEach(row => {
            if (row.object && typeof row.object === 'string') {
                try { row.object = JSON.parse(row.object); } catch { /* mantém string */ }
            }
        });

        return rows;
    } catch (err) {
        await conn.rollback();
        throw new AppError('Erro ao buscar notificações.', 500, err.code, err);
    } finally {
        conn.release();
    }
}

/**
 * Insere uma notificação (uso interno por outros serviços).
 * Falhas silenciosas — notificações nunca devem bloquear o fluxo principal.
 * @param {number} toUserId
 * @param {number} fromUserId
 * @param {number} taskId
 * @param {string} type
 * @param {object} object
 */
async function insertNotification(toUserId, fromUserId, taskId, type, object) {
    try {
        await poolGlobal.execute(SQL_INSERT_NOTIFICATION, [
            toUserId, fromUserId, taskId, type, JSON.stringify(object ?? {}),
        ]);
    } catch (err) {
        console.error('[gtpp:notify] Failed to insert notification:', err.message);
    }
}

module.exports = {
    getAndConsumeNotifications,
    insertNotification,
};
