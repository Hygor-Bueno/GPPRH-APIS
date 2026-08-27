/**
 * @fileoverview Porta (contrato) de publicação de eventos de chat em tempo real.
 *
 * Define o que `ChatUseCases` precisa para notificar usuários via WebSocket,
 * sem saber se a notificação atravessa um processo separado via HTTP (lado
 * REST) ou é entregue diretamente em memória (lado WS).
 *
 * @module modules/global/application/chat/ports/chat-event-publisher.port
 */

class ChatEventPublisherPort {
    /** @param {Object} message - Mensagem persistida a ser anunciada. */
    publishMessageSent(message) { throw new Error('Not implemented'); }

    /** @param {{readerId: number, partnerId: number}} params */
    publishMessagesRead({ readerId, partnerId }) { throw new Error('Not implemented'); }
}

module.exports = { ChatEventPublisherPort };
