/**
 * @fileoverview Consultas SQL puras para notificações GTPP (gt_notify).
 *
 * `SQL_INSERT_NOTIFICATION` é a query canônica usada pelo
 * `HttpGtppEventPublisher` (via `MysqlNotifyRepository`) para persistir
 * notificações offline — único dono deste texto, sem duplicação em
 * `src/websocket/events/gtpp.event.js`.
 *
 * @module modules/global/repositories/mysql/gtpp-notify.queries
 */

const SQL_GET_NOTIFICATIONS        = `SELECT id, user_id, send_user_id, task_id, type, object FROM gt_notify WHERE user_id = ?`;
const SQL_INSERT_NOTIFICATION      = `INSERT INTO gt_notify (user_id, send_user_id, task_id, type, object) VALUES (?, ?, ?, ?, ?)`;
const SQL_DELETE_ALL_NOTIFICATIONS = `DELETE FROM gt_notify WHERE user_id = ?`;

module.exports = {
    SQL_GET_NOTIFICATIONS,
    SQL_INSERT_NOTIFICATION,
    SQL_DELETE_ALL_NOTIFICATIONS,
};
