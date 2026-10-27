/**
 * @fileoverview Adapter — implementa `AccessRequestEventPublisherPort` via HTTP.
 *
 * Mesmo caminho do GTPP e da REPP: o `connectionManager` vive no processo do
 * WebSocket, então a API entrega por `POST WS_EMIT_URL` com
 * `options.toUserIds`.
 *
 * ⚠️ Lista vazia NÃO é enviada: sem `toUserId(s)` o `eventBus` faz broadcast
 * para todos os conectados.
 *
 * Nada é gravado quando o dono está offline: o sino dele é o contador de
 * pendentes (`GET /access/requests/summary`), lido ao logar.
 *
 * @module modules/global/infrastructure/access/http-access-request-event.publisher
 */

const axios = require('axios');
const { AccessRequestEventPublisherPort } = require('../../application/access/ports/access-request-event-publisher.port');
const { ACCESS_WS_EVENT } = require('../../domain/access/access-request.enums');
const { WS_EMIT_URL } = require('../gtpp/http-gtpp-event.publisher');

class HttpAccessRequestEventPublisher extends AccessRequestEventPublisherPort {
    async publish(userIds, payload) {
        const toUserIds = [...new Set((userIds || []).map(Number).filter(id => id > 0))];
        if (!toUserIds.length) return;
        try {
            await axios.post(
                WS_EMIT_URL,
                { event: ACCESS_WS_EVENT, payload, options: { toUserIds } },
                { timeout: 3000 },
            );
        } catch (error) {
            console.error(`[access:request] Failed to call WS emit-event (id=${payload?.request?.id}):`, error.message);
        }
    }
}

module.exports = { HttpAccessRequestEventPublisher };
