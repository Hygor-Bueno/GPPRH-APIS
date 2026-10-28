/**
 * @fileoverview Porta — aviso em tempo real do registro de alterações
 * (`access:request` no WebSocket).
 * @module modules/global/application/access/ports/access-request-event-publisher.port
 */

class AccessRequestEventPublisherPort {
    /**
     * Entrega `payload` só para `userIds`. Nunca lança: o aviso é atalho — o
     * estado verdadeiro está em `GET /access/requests/summary`.
     * @param {number[]} userIds
     * @param {{action: string, request: object}} payload
     */
    publish(userIds, payload) { throw new Error('Not implemented'); }
}

module.exports = { AccessRequestEventPublisherPort };
