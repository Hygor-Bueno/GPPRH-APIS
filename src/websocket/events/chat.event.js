/**
 * @fileoverview Handlers WebSocket — Chat Direto.
 *
 * Trata eventos de chat iniciados pelo cliente via WebSocket, orquestrando
 * via `ChatUseCases` (mesma camada de aplicação consumida pelo controller
 * REST), injetando o adapter de entrega local (`connectionManager`), já que
 * este handler roda no mesmo processo do servidor WebSocket.
 *
 * Fluxo `chat:send`:
 *   1. Cliente envia `{ event: 'chat:send', payload: { to_user_id, message, type } }`
 *   2. Mensagem é persistida no banco `global.cl_message`
 *   3. `chat:delivered` é enviado de volta ao remetente (confirmação)
 *   4. `chat:message`   é enviado ao destinatário (se estiver online)
 *
 * Fluxo `chat:typing`:
 *   1. Cliente envia `{ event: 'chat:typing', payload: { to_user_id } }`
 *   2. `chat:typing { from_user_id }` é encaminhado ao destinatário
 *
 * @module websocket/events/chat.event
 */

const { connectionManager } = require('../connectionManager');
const { ChatUseCases }             = require('../../modules/global/application/chat/chat.use-cases');
const { MysqlChatRepository }      = require('../../modules/global/infrastructure/chat/mysql-chat.repository');
const { WsLocalChatEventPublisher } = require('../../modules/global/infrastructure/chat/ws-local-chat-event.publisher');
const { AppError } = require('../../errors/app.error');

function createUseCases() {
    return new ChatUseCases({
        repository: new MysqlChatRepository(),
        eventPublisher: new WsLocalChatEventPublisher()
    });
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * Processa o envio de uma mensagem de texto via WebSocket.
 *
 * Valida o payload, persiste no banco e entrega ao destinatário em tempo real.
 * Em caso de erro, envia `chat:error` de volta ao remetente.
 *
 * @param {import('ws')} ws     - Conexão WebSocket do remetente (com `ws.userId` definido).
 * @param {Object} payload      - Dados da mensagem.
 * @param {number} payload.to_user_id  - ID do destinatário.
 * @param {string} payload.message     - Conteúdo da mensagem.
 * @param {string} [payload.type='text'] - Tipo: `'text'`, `'image'` ou `'file'`.
 * @returns {Promise<void>}
 */
async function handleChatSend(ws, payload) {
    const { to_user_id, message, type } = payload || {};

    // ── Validação básica de forma do payload (transporte, não regra de domínio) ──
    if (!to_user_id || typeof to_user_id !== 'number') {
        return _sendError(ws, 'Campo `to_user_id` é obrigatório e deve ser um número.');
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
        return _sendError(ws, 'Campo `message` é obrigatório e não pode ser vazio.');
    }

    try {
        const useCases = createUseCases();
        await useCases.sendMessage({
            senderId: ws.userId,
            recipientId: to_user_id,
            message: message.trim(),
            type
        });
    } catch (err) {
        if (err instanceof AppError) {
            // Erro de negócio (ex.: self-send) — mensagem segura de expor ao cliente
            return _sendError(ws, err.message);
        }
        console.error(`[chat:send] Failed to save message (userId=${ws.userId}):`, err.message);
        _sendError(ws, 'Erro interno ao enviar mensagem. Tente novamente.');
    }
}

/**
 * Encaminha o indicador de digitação ao destinatário.
 *
 * Não persiste nada no banco — é apenas uma notificação efêmera em tempo real.
 *
 * @param {import('ws')} ws     - Conexão WebSocket do remetente.
 * @param {Object} payload      - Dados do evento.
 * @param {number} payload.to_user_id - ID do destinatário.
 * @returns {void}
 */
function handleChatTyping(ws, payload) {
    const { to_user_id } = payload || {};

    if (!to_user_id || typeof to_user_id !== 'number') return;
    if (to_user_id === ws.userId) return;

    connectionManager.sendToUser(to_user_id, {
        event:   'chat:typing',
        payload: { from_user_id: ws.userId }
    });
}

function handleChatNudge(ws, payload) {
    const { to_user_id } = payload || {};

    if (!to_user_id || typeof to_user_id !== 'number') return;
    if (to_user_id === ws.userId) return;

    connectionManager.sendToUser(to_user_id, {
        event:   'chat:nudge',
        payload: { from_user_id: ws.userId }
    });
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Envia um evento de erro ao cliente WebSocket.
 *
 * @private
 * @param {import('ws')} ws  - Conexão WebSocket do remetente.
 * @param {string}       msg - Mensagem de erro legível.
 * @returns {void}
 */
function _sendError(ws, msg) {
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ event: 'chat:error', payload: { message: msg } }));
    }
}

module.exports = { handleChatSend, handleChatTyping, handleChatNudge };
