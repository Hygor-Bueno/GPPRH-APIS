/**
 * @fileoverview Porta do lembrete da REPP (`re_bookings.reminder_*`).
 *
 * Quem decide se um lembrete está vencido é a consulta (ver
 * `repp-reminder.queries`): a regra depende do relógio do banco, e repeti-la
 * aqui seria ter duas versões dela.
 *
 * @module modules/global/application/repp/reminder/ports/reminder-repository.port
 */

/**
 * @typedef {object} DueReminderTransaction
 * @property {object} booking  a reserva completa, travada e ainda vencida.
 * @property {() => Promise<void>} markSent  carimba `reminder_sent_at`.
 * @property {(notice: {user_id: number, booking_id: number, action: string, by_user_id: null, payload: object}) => Promise<number>} insertNotification
 *   grava o aviso na MESMA transação do carimbo. Devolve o id (vai no `repp:event`).
 */

class ReminderRepositoryPort {
    /**
     * @param {number} limit
     * @returns {Promise<number[]>} ids de reservas com lembrete vencido.
     */
    listDueIds(limit) { throw new Error('Not implemented'); }

    /**
     * Trava a reserva e roda `work` SE o lembrete continua vencido; senão
     * devolve `null` sem chamar `work`. Tudo que `work` gravar fica na mesma
     * transação; exceção desfaz.
     *
     * @template T
     * @param {number} bookingId
     * @param {(tx: DueReminderTransaction) => Promise<T>} work
     * @returns {Promise<T|null>}
     */
    withDueReminder(bookingId, work) { throw new Error('Not implemented'); }
}

module.exports = { ReminderRepositoryPort };
