/**
 * @fileoverview Enum do campo `type` (INT) da tabela `cl_message`.
 * Legado PHP: 1 = texto, 2 = imagem, 3 = arquivo genérico.
 *
 * @module modules/global/domain/chat/chat-message-type.enum
 */

const ChatMessageType = Object.freeze({
    TEXT: 1,
    IMAGE: 2,
    FILE: 3
});

module.exports = { ChatMessageType };
