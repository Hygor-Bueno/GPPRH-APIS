/**
 * @fileoverview Adapter de publicação de eventos — lado REST.
 *
 * Implementa `ChatEventPublisherPort` postando no endpoint interno do
 * servidor WebSocket (processo separado, porta 4001), já que o processo da
 * API REST não tem acesso direto às conexões WS abertas.
 *
 * @module modules/global/infrastructure/chat/ws-http-chat-event.publisher
 */

const axios = require('axios');
const { ChatEventPublisherPort } = require('../../application/chat/ports/chat-event-publisher.port');

/** URL interna do servidor WebSocket para emissão de eventos. @constant {string} */
const WS_EMIT_URL = 'http://localhost:4001/ws/emit-event';

class WsHttpChatEventPublisher extends ChatEventPublisherPort {
    async publishMessageSent(message) {
        const emitTo = (event, toUserId) =>
            axios.post(WS_EMIT_URL, {
                event,
                payload: {
                    id: message.id,
                    sender_id: message.sender_id,
                    recipient_id: message.recipient_id,
                    message: message.message,
                    type: message.type,
                    file_id: message.file_id ?? null,
                    file_name: message.file_name ?? null,
                    notification: message.notification,
                    date: message.date
                },
                options: { toUserId }
            }).catch(err =>
                console.error(`[chat] Failed to emit '${event}' to userId=${toUserId}:`, err.message)
            );

        emitTo('chat:message', message.recipient_id);
        emitTo('chat:delivered', message.sender_id);
    }

    async publishMessagesRead({ readerId, partnerId }) {
        axios.post(WS_EMIT_URL, {
            event: 'chat:read',
            payload: { reader_id: readerId, partner_id: partnerId },
            options: { toUserId: partnerId }
        }).catch(err =>
            console.error('[chat:read] Failed to emit WS event:', err.message)
        );
    }
}

module.exports = { WsHttpChatEventPublisher, WS_EMIT_URL };
