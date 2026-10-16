/**
 * @fileoverview SQL de `re_notifications` (REPP).
 *
 * `SQL_INSERT_NOTIFICATION` é o texto canônico: quem grava é a transação da
 * reserva (`mysql-repp-booking.repository`), que importa daqui.
 *
 * Buscar não marca como lida nem apaga — `read_at` só muda pela confirmação,
 * e só lidas antigas são apagadas.
 *
 * @module modules/global/repositories/mysql/repp-notification.queries
 */

const { localDateTime } = require('./mysql-datetime.sql');

const SQL_INSERT_NOTIFICATION = `
    INSERT INTO re_notifications (user_id, booking_id, action, by_user_id, payload)
    VALUES (?, ?, ?, ?, ?)`;

const SQL_LIST_UNREAD = `
    SELECT id,
           booking_id,
           action,
           by_user_id,
           payload,
           ${localDateTime('created_at')},
           ${localDateTime('read_at')}
      FROM re_notifications
     WHERE user_id = ?
       AND read_at IS NULL
     ORDER BY id DESC
     LIMIT ?`;

/**
 * Idempotente: `read_at IS NULL` mantém a data da primeira leitura, e
 * `user_id = ?` faz id de outra pessoa ser ignorado em silêncio.
 */
const SQL_MARK_READ = `
    UPDATE re_notifications
       SET read_at = NOW()
     WHERE id IN (?)
       AND user_id = ?
       AND read_at IS NULL`;

/** Retenção: lidas há mais de N dias, em lote (`LIMIT`) para não segurar a tabela. */
const SQL_PURGE_READ = `
    DELETE FROM re_notifications
     WHERE read_at IS NOT NULL
       AND read_at < NOW() - INTERVAL ? DAY
     LIMIT ?`;

module.exports = {
    SQL_INSERT_NOTIFICATION,
    SQL_LIST_UNREAD,
    SQL_MARK_READ,
    SQL_PURGE_READ,
};
