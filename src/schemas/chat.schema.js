/**
 * @fileoverview Schemas de validação — Chat Direto.
 *
 * Define as regras de validação para as rotas de mensagens diretas entre usuários.
 *
 * @module schemas/chat.schema
 */

/**
 * Schema para envio de mensagem de texto via REST (POST /chat/messages).
 *
 * O campo `type` é opcional ('text' | 'image' | 'file') e é normalizado
 * diretamente no controller para evitar conflito de nomes com a propriedade
 * `type` das próprias regras do schema de validação.
 */
const sendMessageSchema = {
    to_user_id: {
        type:     'number',
        required: true,
        min:      1
    },
    message: {
        type:      'string',
        required:  true,
        minLength: 1,
        maxLength: 5000
    }
};

/**
 * Schema para marcar mensagens como lidas (PUT /chat/messages/read).
 */
const markAsReadSchema = {
    partner_id: {
        type:     'number',
        required: true,
        min:      1
    }
};

/**
 * Schema para query params da listagem de mensagens (GET /chat/messages).
 * Validação manual no controller (query params não passam pelo `validate` middleware).
 *
 * @type {{ with_user_id: number, page?: number }}
 */
const getMessagesQuerySchema = {
    with_user_id: {
        type:     'number',
        required: true,
        min:      1
    },
    page: {
        type:     'number',
        required: false,
        min:      1
    }
};

module.exports = {
    sendMessageSchema,
    markAsReadSchema,
    getMessagesQuerySchema
};
