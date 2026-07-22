/**
 * @fileoverview Controller de Chat Direto.
 *
 * Camada de entrada HTTP para o sistema de mensagens diretas.
 * Após persistir a mensagem, notifica o destinatário via WebSocket
 * postando no endpoint interno do servidor WS (`/ws/emit-event`).
 *
 * Rotas cobertas:
 *   GET    /chat/conversations          - Lista conversas do usuário autenticado
 *   GET    /chat/messages               - Mensagens paginadas com um parceiro
 *   POST   /chat/messages               - Envia mensagem de texto
 *   POST   /chat/messages/file          - Envia arquivo (multipart/form-data)
 *   PUT    /chat/messages/read          - Marca mensagens de um parceiro como lidas
 *
 * @module modules/global/controllers/chat.controller
 */

const path  = require('path');
const axios = require('axios');

const { ChatService }  = require('../services/chat.service');
const { FileService }  = require('../../../utils/file/file.service');
const { respond }      = require('../../../utils/respond');
const { AppError }     = require('../../../errors/app.error');

/** URL interna do servidor WebSocket para emissão de eventos. @constant {string} */
const WS_EMIT_URL = 'http://localhost:4001/ws/emit-event';

/**
 * Módulo identificador para o FileService.
 * Arquivos de chat ficam em: Storage/CHAT/uploads/{YYYY}/{MM}/{DD}/{hash}.ext
 * e são registrados em `_files` com `created_by_fk = req.user.id`.
 */
const CHAT_MODULE = 'CLPP';

// ─── Helper Interno ───────────────────────────────────────────────────────────

/** MIMEs de imagem — mapeiam para type=2 em `cl_message`. */
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * Mapa string → inteiro para a coluna `type` (INT) da tabela `cl_message`.
 * Legado PHP: 1 = texto, 2 = imagem, 3 = arquivo genérico.
 */
const TYPE_TO_INT = { text: 1, image: 2, file: 3 };

/**
 * Normaliza o campo `type` recebido no body e retorna o inteiro correto para o banco.
 * Aceita string ('text', 'image', 'file') ou inteiro (1, 2, 3).
 * Retorna `1` (text) como fallback seguro para qualquer valor desconhecido.
 *
 * @private
 * @param {*} raw - Valor bruto de `req.body.type`.
 * @returns {1|2|3}
 */
function _normalizeType(raw) {
    if (raw === undefined || raw === null) return 1;
    if (typeof raw === 'number' && [1, 2, 3].includes(raw)) return raw;
    const str = String(raw).trim().toLowerCase();
    return TYPE_TO_INT[str] ?? 1;
}

/**
 * Emite os eventos WebSocket após o envio de uma mensagem.
 *
 * Dispara de forma assíncrona, sem bloquear a resposta HTTP.
 * Falhas no WS são apenas logadas, não propagadas.
 *
 * Eventos emitidos:
 *   - `chat:message`   → ao destinatário (nova mensagem)
 *   - `chat:delivered` → ao remetente (confirmação de entrega)
 *
 * @private
 * @param {Object} message - Mensagem persistida retornada pelo serviço.
 * @returns {void}
 */
function _emitChatEvents(message) {
    const emitTo = (event, toUserId) =>
        axios.post(WS_EMIT_URL, {
            event,
            payload: {
                id:           message.id,
                sender_id:    message.sender_id,
                recipient_id: message.recipient_id,
                message:      message.message,
                type:         message.type,
                file_id:      message.file_id   ?? null,
                file_name:    message.file_name ?? null,
                notification: message.notification,
                date:         message.date
            },
            options: { toUserId }
        }).catch(err =>
            console.error(`[chat] Failed to emit '${event}' to userId=${toUserId}:`, err.message)
        );

    emitTo('chat:message',   message.recipient_id);
    emitTo('chat:delivered', message.sender_id);
}

// ─── Handlers REST ────────────────────────────────────────────────────────────

/**
 * Lista as conversas diretas do usuário autenticado.
 *
 * @route GET /chat/conversations
 * @access Requer `USE_CHAT`
 * @param {import('express').Request}  req - Requisição Express (usuário via `req.user.id`).
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com lista de conversas (`partner_id`, `partner_name`, `unread_count`).
 */
/**
 * Serve um arquivo de chat diretamente pelo Express.
 *
 * Rota pública (sem auth) para que tags <img src="..."> e links de download
 * funcionem sem precisar enviar credenciais. Os nomes de arquivo são UUIDs
 * gerados aleatoriamente, portanto não são adivinháveis.
 *
 * @route GET /chat/uploads/:filename
 * @param {import('express').Request}  req - `params.filename` = nome do arquivo.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {void}
 */
function serveFile(req, res) {
    const filename = path.basename(req.params.filename); // sanitiza path traversal
    const filePath = path.join(CHAT_UPLOAD_DIR, filename);

    res.sendFile(filePath, err => {
        if (err) res.status(404).json({ error: true, message: 'Arquivo não encontrado.' });
    });
}

async function getConversations(req, res) {
    const service = new ChatService();
    const data    = await service.getConversations(req.user.id);
    return respond.ok(res, data);
}

/**
 * Retorna mensagens paginadas entre o usuário autenticado e um parceiro.
 *
 * @route GET /chat/messages?with_user_id=:id&page=:n
 * @access Requer `USE_CHAT`
 * @param {import('express').Request}  req - Query params: `with_user_id` (obrigatório), `page` (padrão 1).
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com `{ messages, total, page, pages }`.
 */
async function getMessages(req, res) {
    const partnerId = parseInt(req.query.with_user_id, 10);
    const page      = parseInt(req.query.page, 10) || 1;

    if (!partnerId || isNaN(partnerId) || partnerId < 1) {
        throw new AppError('Parâmetro `with_user_id` é obrigatório e deve ser um número válido.', 400);
    }

    const service = new ChatService();
    const data    = await service.getMessages(req.user.id, partnerId, page);
    return respond.ok(res, data);
}

/**
 * Envia uma mensagem de texto para outro usuário.
 *
 * Após persistir, emite `chat:message` ao destinatário e `chat:delivered` ao remetente via WS.
 *
 * @route POST /chat/messages
 * @access Requer `USE_CHAT`
 * @param {import('express').Request}  req - Body: `{ to_user_id, message, type? }`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `201 Created` com a mensagem persistida.
 */
async function sendMessage(req, res) {
    const { to_user_id, message } = req.body;
    const type = _normalizeType(req.body.type);

    if (to_user_id === req.user.id) {
        throw new AppError('Não é possível enviar mensagem para si mesmo.', 400);
    }

    const service    = new ChatService();
    const savedMsg   = await service.sendMessage(req.user.id, to_user_id, message, type);

    _emitChatEvents(savedMsg);

    return respond.created(res, savedMsg);
}

/**
 * Envia um arquivo (imagem ou documento) como mensagem.
 *
 * O arquivo é armazenado em disco. A URL pública é salva como conteúdo da mensagem.
 * O tipo é inferido automaticamente pelo MIME type do arquivo.
 *
 * Após persistir, emite `chat:message` e `chat:delivered` via WS.
 *
 * @route POST /chat/messages/file
 * @access Requer `USE_CHAT`
 * @param {import('express').Request}  req - `req.body.to_user_id` + `req.file` (multipart).
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `201 Created` com a mensagem persistida.
 */
async function uploadFile(req, res) {
    if (!req.file) {
        throw new AppError('Nenhum arquivo enviado.', 400);
    }

    const toUserId = parseInt(req.body.to_user_id, 10);
    if (!toUserId || isNaN(toUserId) || toUserId < 1) {
        throw new AppError('Campo `to_user_id` é obrigatório.', 400);
    }
    if (toUserId === req.user.id) {
        throw new AppError('Não é possível enviar mensagem para si mesmo.', 400);
    }

    // Valida, escaneia, deduplica e salva via FileService centralizado
    const fileRecord = await FileService.save(req.file, CHAT_MODULE, req.user.id);

    // Tipo da mensagem inferido pelo MIME real detectado pelo FileService
    const msgType = IMAGE_MIMES.has(fileRecord.file_type) ? 2 : 3;

    // `message` armazena texto opcional enviado junto com o arquivo
    // `file_name` guarda o snapshot imutável do nome do arquivo
    const service  = new ChatService();
    const savedMsg = await service.sendMessage(
        req.user.id, toUserId,
        req.body.message ?? null,
        msgType,
        fileRecord.id,
        req.body.file_name ?? Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    );

    _emitChatEvents(savedMsg);

    return respond.created(res, savedMsg);
}

/**
 * Marca como lidas todas as mensagens recebidas de um parceiro.
 *
 * @route PUT /chat/messages/read
 * @access Requer `USE_CHAT`
 * @param {import('express').Request}  req - Body: `{ partner_id }`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com `{ updated: number }`.
 */
async function markAsRead(req, res) {
    const { partner_id } = req.body;

    const service = new ChatService();
    const result  = await service.markAsRead(req.user.id, partner_id);

    // Notifica o remetente original que suas mensagens foram lidas
    if (result.updated > 0) {
        axios.post(WS_EMIT_URL, {
            event:   'chat:read',
            payload: {
                reader_id:  req.user.id,
                partner_id: parseInt(partner_id, 10),
            },
            options: { toUserId: parseInt(partner_id, 10) },
        }).catch(err =>
            console.error('[chat:read] Failed to emit WS event:', err.message)
        );
    }

    return respond.ok(res, result);
}

module.exports = {
    serveFile,
    getConversations,
    getMessages,
    sendMessage,
    uploadFile,
    markAsRead
};
