/**
 * @fileoverview Handlers WebSocket — Chat Direto.
 *
 * Trata eventos de chat iniciados pelo cliente via WebSocket.
 * O fluxo unificado elimina a necessidade de dois passos separados
 * (REST para salvar + WS para notificar) do sistema PHP legado.
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
const { ChatService }       = require('../../modules/global/services/chat.service');

/** Mapa string → inteiro para a coluna `type` (INT) da tabela `cl_message`. */
const TYPE_TO_INT = { text: 1, image: 2, file: 3 };

/**
 * Converte o `type` enviado pelo cliente (string ou int) para o inteiro do banco.
 * @param {*} raw
 * @returns {1|2|3}
 */
function _resolveType(raw) {
    if (typeof raw === 'number' && [1, 2, 3].includes(raw)) return raw;
    const str = String(raw ?? 'text').trim().toLowerCase();
    return TYPE_TO_INT[str] ?? 1;
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
    const { to_user_id, message } = payload || {};
    const type = _resolveType((payload || {}).type);

    // ── Validação básica ──────────────────────────────────────────────────────
    if (!to_user_id || typeof to_user_id !== 'number') {
        return _sendError(ws, 'Campo `to_user_id` é obrigatório e deve ser um número.');
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
        return _sendError(ws, 'Campo `message` é obrigatório e não pode ser vazio.');
    }
    if (to_user_id === ws.userId) {
        return _sendError(ws, 'Não é possível enviar mensagem para si mesmo.');
    }

    try {
        const service  = new ChatService();
        const savedMsg = await service.sendMessage(ws.userId, to_user_id, message.trim(), type);

        const wsPayload = {
            id:           savedMsg.id,
            sender_id:    savedMsg.sender_id,
            recipient_id: savedMsg.recipient_id,
            message:      savedMsg.message,
            type:         savedMsg.type,
            file_id:      savedMsg.file_id ?? null,
            notification: savedMsg.notification,
            date:         savedMsg.date
        };

        // Confirmação ao remetente
        connectionManager.sendToUser(ws.userId, {
            event:   'chat:delivered',
            payload: wsPayload
        });

        // Entrega ao destinatário (se estiver online)
        connectionManager.sendToUser(to_user_id, {
            event:   'chat:message',
            payload: wsPayload
        });

    } catch (err) {
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
