/**
 * @fileoverview Adapter MySQL — implementa `NotifyRepositoryPort`.
 *
 * @module modules/global/infrastructure/gtpp/mysql-notify.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { NotifyRepositoryPort } = require('../../application/gtpp/notify/ports/notify-repository.port');
const {
    SQL_GET_NOTIFICATIONS, SQL_INSERT_NOTIFICATION, SQL_DELETE_ALL_NOTIFICATIONS,
} = require('../../repositories/mysql/gtpp-notify.queries');

class MysqlNotifyRepository extends NotifyRepositoryPort {
    /**
     * SELECT + DELETE atômicos — evita race condition se chamado
     * simultaneamente (mesmo comportamento do service legado).
     */
    async getAndConsume(userId) {
        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();
            const [rows] = await conn.execute(SQL_GET_NOTIFICATIONS, [userId]);
            await conn.execute(SQL_DELETE_ALL_NOTIFICATIONS, [userId]);
            await conn.commit();
            return rows;
        } catch (error) {
            await conn.rollback();
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao buscar notificações.', 500, {
                code: 'GTPP_NOTIFY_MYSQL_ERROR',
                details: error
            });
        } finally {
            conn.release();
        }
    }

    async insertNotification(toUserId, fromUserId, taskId, type, objectJson) {
        try {
            await poolGlobal.execute(SQL_INSERT_NOTIFICATION, [toUserId, fromUserId, taskId, type, objectJson]);
        } catch (error) {
            throw new AppError(error.message || 'Erro ao gravar notificação.', 500, {
                code: 'GTPP_NOTIFY_MYSQL_ERROR',
                details: error
            });
        }
    }
}

module.exports = { MysqlNotifyRepository };
