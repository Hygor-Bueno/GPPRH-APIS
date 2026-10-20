/**
 * @fileoverview SQL do lembrete da REPP — lido só pelo worker `repp-reminder`.
 *
 * ─── Hora ───────────────────────────────────────────────────────────────────
 * `booking_date` + `start_time` são hora local de parede, e o `global` roda
 * com `time_zone = SYSTEM` em `-03` (conferido em 19/10/2026): `NOW()` sai
 * na mesma hora local, então a comparação é direta, sem conversão de fuso.
 *
 * ─── Quando um lembrete está "vencido" ──────────────────────────────────────
 * Aprovada, com lembrete pedido e ainda não enviado, de reserva com criador,
 * que ainda não começou e cujo horário do lembrete já chegou. "Já chegou" e
 * não "chegou agora": lembrete atrasado (aprovação tardia, reserva em cima da
 * hora, worker parado) dispara na hora (decisão do Hygor, 19/10/2026). Reserva
 * que começou sem o lembrete sair fica sem ele — avisar depois não serve.
 *
 * O recorte por `booking_date` só existe para a consulta usar índice: nenhum
 * lembrete antecede a reserva em mais que o maior valor de `REMINDER_OPTIONS`.
 *
 * @module modules/global/repositories/mysql/repp-reminder.queries
 */

const { BookingStatus, REMINDER_OPTIONS } = require('../../domain/repp/repp.enums');
const { DETAIL_COLUMNS, DETAIL_FROM } = require('./repp-booking.queries');

/** Dias à frente que um lembrete pode alcançar (1440 min → 1 dia). */
const REMINDER_HORIZON_DAYS = Math.ceil(Math.max(...REMINDER_OPTIONS) / 1440);

const DUE_CONDITION = `
           b.status           = '${BookingStatus.Approved}'
       AND b.reminder_minutes IS NOT NULL
       AND b.reminder_sent_at IS NULL
       AND b.created_by       IS NOT NULL
       AND b.booking_date BETWEEN CURDATE() AND CURDATE() + INTERVAL ${REMINDER_HORIZON_DAYS} DAY
       AND TIMESTAMP(b.booking_date, b.start_time) > NOW()
       AND TIMESTAMP(b.booking_date, b.start_time) - INTERVAL b.reminder_minutes MINUTE <= NOW()`;

/** Ids vencidos, da reserva mais próxima para a mais distante. */
const SQL_LIST_DUE_REMINDERS = `
    SELECT b.id
      FROM re_bookings b
     WHERE ${DUE_CONDITION}
     ORDER BY b.booking_date, b.start_time, b.id
     LIMIT ?`;

/**
 * A reserva completa, travada, SE continua vencida — entre a listagem e aqui
 * ela pode ter sido cancelada, remarcada ou ter o lembrete trocado.
 * `FOR UPDATE OF b` trava só a reserva: sem o `OF`, o InnoDB travaria também
 * as linhas de `re_spaces` e `_user` do JOIN, e o espaço é a trava das
 * escritas de reserva (`SQL_LOCK_SPACES`).
 */
const SQL_LOCK_DUE_REMINDER = `
    SELECT ${DETAIL_COLUMNS}
      ${DETAIL_FROM}
     WHERE b.id = ?
       AND ${DUE_CONDITION}
       FOR UPDATE OF b`;

const SQL_MARK_REMINDER_SENT = `
    UPDATE re_bookings
       SET reminder_sent_at = NOW()
     WHERE id = ?
       AND reminder_sent_at IS NULL`;

module.exports = {
    REMINDER_HORIZON_DAYS,
    SQL_LIST_DUE_REMINDERS,
    SQL_LOCK_DUE_REMINDER,
    SQL_MARK_REMINDER_SENT,
};
