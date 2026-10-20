/**
 * @fileoverview Porta do aviso em tempo real (`repp:event` no WebSocket).
 *
 * É só o atalho: o aviso já está gravado em `re_notifications` quando isto
 * é chamado. Por isso a implementação NUNCA lança — falha de WebSocket não
 * desfaz nem atrasa a ação, e quem não recebeu em tempo real recebe no GET.
 *
 * @module modules/global/application/repp/booking/ports/booking-event-publisher.port
 */

class BookingEventPublisherPort {
    /**
     * @param {number} userId - destinatário (criador da reserva).
     * @param {object} payload - `notification.rules.toEventPayload`, com o `id` da linha gravada.
     * @returns {Promise<void>}
     */
    publish(userId, payload) { throw new Error('Not implemented'); }
}

module.exports = { BookingEventPublisherPort };
