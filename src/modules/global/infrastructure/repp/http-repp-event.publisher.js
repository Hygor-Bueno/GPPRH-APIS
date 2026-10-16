/**
 * @fileoverview Adapter — implementa `BookingEventPublisherPort` via HTTP.
 *
 * Mesmo caminho do GTPP: o `connectionManager` vive no processo do WebSocket
 * (container `ws-gipp-enterprises`), então a API entrega por
 * `POST WS_EMIT_URL` (`/ws/emit-event`) com `options.toUserId` — só o
 * destinatário recebe, e quem agiu já ficou de fora na regra de domínio.
 *
 * Diferente do GTPP, NÃO grava nada quando o usuário está offline: o aviso já
 * foi gravado, para todos, na transação da ação. Aqui é só o atalho em tempo
 * real, e por isso este método nunca lança.
 *
 * @module modules/global/infrastructure/repp/http-repp-event.publisher
 */

const axios = require('axios');
const { BookingEventPublisherPort } = require('../../application/repp/booking/ports/booking-event-publisher.port');
const { REPP_WS_EVENT } = require('../../domain/repp/repp.enums');
// Mesmo endereço do GTPP (`WS_EMIT_URL` do compose) — um lugar só para o default.
const { WS_EMIT_URL } = require('../gtpp/http-gtpp-event.publisher');

class HttpReppEventPublisher extends BookingEventPublisherPort {
    async publish(userId, payload) {
        try {
            await axios.post(
                WS_EMIT_URL,
                { event: REPP_WS_EVENT, payload, options: { toUserId: userId } },
                { timeout: 3000 },
            );
        } catch (error) {
            console.error(`[repp:event] Failed to call WS emit-event (user=${userId}, id=${payload?.id}):`, error.message);
        }
    }
}

module.exports = { HttpReppEventPublisher };
