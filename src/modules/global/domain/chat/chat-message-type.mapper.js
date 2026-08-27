/**
 * @fileoverview Normalização do campo `type` de mensagens de chat.
 *
 * Única implementação de normalização de tipo do módulo de chat — antes
 * duplicada entre `chat.controller.js` (`_normalizeType`) e `chat.event.js`
 * (`_resolveType`).
 *
 * @module modules/global/domain/chat/chat-message-type.mapper
 */

const { ChatMessageType } = require('./chat-message-type.enum');

/** Mapa string → inteiro para a coluna `type` (INT) da tabela `cl_message`. */
const TYPE_TO_INT = {
    text: ChatMessageType.TEXT,
    image: ChatMessageType.IMAGE,
    file: ChatMessageType.FILE
};

const VALID_TYPES = Object.values(ChatMessageType);

/**
 * Normaliza o campo `type` recebido (via HTTP body ou payload WS) para o
 * inteiro correto do banco. Aceita string ('text', 'image', 'file') ou
 * inteiro (1, 2, 3). Retorna `ChatMessageType.TEXT` como fallback seguro
 * para qualquer valor ausente ou desconhecido.
 *
 * @param {*} raw - Valor bruto recebido.
 * @returns {1|2|3}
 */
function normalizeChatMessageType(raw) {
    if (raw === undefined || raw === null) return ChatMessageType.TEXT;
    if (typeof raw === 'number' && VALID_TYPES.includes(raw)) return raw;
    const str = String(raw).trim().toLowerCase();
    return TYPE_TO_INT[str] ?? ChatMessageType.TEXT;
}

module.exports = { normalizeChatMessageType };
