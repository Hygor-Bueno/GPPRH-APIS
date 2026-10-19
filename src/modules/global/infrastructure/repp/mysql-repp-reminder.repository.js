/**
 * @fileoverview Adapter MySQL do lembrete da REPP.
 *
 * O carimbo (`reminder_sent_at`) e o aviso (`re_notifications`) entram na
 * mesma transação, com a reserva travada: ou o lembrete foi enviado e está
 * no sino, ou nada aconteceu e o próximo ciclo tenta de novo. Nunca os dois
 * pela metade, e nunca duas vezes — mesmo com um segundo worker de pé, o
 * segundo encontra a linha já carimbada ao conseguir a trava.
 *
 * @module modules/global/infrastructure/repp/mysql-repp-reminder.repository
 */

const { ReminderRepositoryPort } = require('../../application/repp/reminder/ports/reminder-repository.port');
const { query, transaction } = require('./repp-mysql.helper');
const {
    SQL_LIST_DUE_REMINDERS,
    SQL_LOCK_DUE_REMINDER,
    SQL_MARK_REMINDER_SENT,
} = require('../../repositories/mysql/repp-reminder.queries');
const { SQL_INSERT_NOTIFICATION } = require('../../repositories/mysql/repp-notification.queries');

class MysqlReppReminderRepository extends ReminderRepositoryPort {
    async listDueIds(limit) {
        const rows = await query(SQL_LIST_DUE_REMINDERS, [limit]);
        return rows.map((row) => Number(row.id));
    }

    async withDueReminder(bookingId, work) {
        return transaction(async (conn) => {
            const [booking] = await query(SQL_LOCK_DUE_REMINDER, [bookingId], conn);
            if (!booking) return null;
            return work({
                booking,
                async markSent() {
                    await query(SQL_MARK_REMINDER_SENT, [bookingId], conn);
                },
                async insertNotification({ user_id, booking_id, action, by_user_id, payload }) {
                    const result = await query(SQL_INSERT_NOTIFICATION, [
                        user_id, booking_id, action, by_user_id, JSON.stringify(payload),
                    ], conn);
                    return result.insertId;
                },
            });
        });
    }
}

module.exports = { MysqlReppReminderRepository };
