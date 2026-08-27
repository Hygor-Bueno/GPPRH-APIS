/**
 * @fileoverview Entidade de domínio — Mensagem de Chat Direto.
 *
 * Representa uma mensagem a ser enviada, aplicando normalização e regras de
 * negócio no construtor (mesmo padrão de `gpprh/domain/jobs/job.entity.js`).
 * Única implementação do guard de "não enviar mensagem para si mesmo" —
 * antes duplicado entre `chat.controller.js` e `chat.event.js`.
 *
 * @module modules/global/domain/chat/chat-message.entity
 */

const { AppError } = require('../../../../errors/app.error');
const { normalizeChatMessageType } = require('./chat-message-type.mapper');

class ChatMessageEntity {
    constructor(data = {}) {
        this.assign(data);
        this.normalize();
        this.validateBusinessRules();
    }

    assign(data) {
        this.senderId = data.senderId;
        this.recipientId = data.recipientId;
        this.message = data.message ?? null;
        this.type = data.type;
        this.fileId = data.fileId ?? null;
        this.fileName = data.fileName ?? null;
    }

    normalize() {
        this.type = normalizeChatMessageType(this.type);
        if (typeof this.message === 'string') {
            this.message = this.message.trim() || null;
        }
    }

    validateBusinessRules() {
        if (this.senderId === this.recipientId) {
            throw new AppError('Não é possível enviar mensagem para si mesmo.', 400, {
                code: 'CHAT_SELF_SEND_NOT_ALLOWED'
            });
        }
    }
}

module.exports = { ChatMessageEntity };
