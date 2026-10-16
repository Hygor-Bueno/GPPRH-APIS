/**
 * @fileoverview Adapter MySQL de `re_notifications` (leitura e confirmação).
 *
 * @module modules/global/infrastructure/repp/mysql-repp-notification.repository
 */

const { NotificationRepositoryPort } = require('../../application/repp/notification/ports/notification-repository.port');
const { query } = require('./repp-mysql.helper');
const {
    SQL_LIST_UNREAD,
    SQL_MARK_READ,
    SQL_PURGE_READ,
} = require('../../repositories/mysql/repp-notification.queries');

class MysqlReppNotificationRepository extends NotificationRepositoryPort {
    async listUnread(userId, limit) {
        return query(SQL_LIST_UNREAD, [userId, limit]);
    }

    async markRead(ids, userId) {
        const result = await query(SQL_MARK_READ, [ids, userId]);
        return result.affectedRows;
    }

    async purgeRead(days, batchSize) {
        const result = await query(SQL_PURGE_READ, [days, batchSize]);
        return result.affectedRows;
    }
}

module.exports = { MysqlReppNotificationRepository };
