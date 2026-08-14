/**
 * @fileoverview Adapter de publicação de eventos — lado WebSocket.
 *
 * Implementa `ChatEventPublisherPort` entregando eventos diretamente via
 * `connectionManager`, já que este adapter roda no mesmo processo do
 * servidor WebSocket (sem necessidade de HTTP).
 *
 * @module modules/global/infrastructure/chat/ws-local-chat-event.publisher
 */

const { connectionManager } = require('../../../../websocket/connectionManager');
const { ChatEventPublisherPort } = require('../../application/chat/ports/chat-event-publisher.port');

class WsLocalChatEventPublisher extends ChatEventPublisherPort {
    async publishMessageSent(message) {
        const wsPayload = {
            id: message.id,
            sender_id: message.sender_id,
            recipient_id: message.recipient_id,
            message: message.message,
            type: message.type,
            file_id: message.file_id ?? null,
            notification: message.notification,
            date: message.date
        };

        // Confirmação ao remetente
        connectionManager.sendToUser(message.sender_id, { event: 'chat:delivered', payload: wsPayload });

        // Entrega ao destinatário (se estiver online)
        connectionManager.sendToUser(message.recipient_id, { event: 'chat:message', payload: wsPayload });
    }

    async publishMessagesRead({ readerId, partnerId }) {
        connectionManager.sendToUser(partnerId, {
            event: 'chat:read',
            payload: { reader_id: readerId, partner_id: partnerId }
        });
    }
}

module.exports = { WsLocalChatEventPublisher };
