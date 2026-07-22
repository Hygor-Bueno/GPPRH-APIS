/**
 * @fileoverview Controller de Chat Direto.
 *
 * Camada de entrada HTTP para o sistema de mensagens diretas. Orquestra via
 * `ChatUseCases` (camada de aplicação), injetando os adapters de
 * infraestrutura MySQL e de publicação de eventos via HTTP para o servidor
 * WebSocket (`/ws/emit-event`).
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

const { ChatUseCases }             = require('../application/chat/chat.use-cases');
const { MysqlChatRepository }      = require('../infrastructure/chat/mysql-chat.repository');
const { WsHttpChatEventPublisher } = require('../infrastructure/chat/ws-http-chat-event.publisher');
const { ChatMessageEntity }        = require('../domain/chat/chat-message.entity');
const { FileService }  = require('../../../utils/file/file.service');
const { respond }      = require('../../../utils/respond');
const { AppError }     = require('../../../errors/app.error');

/**
 * Módulo identificador para o FileService.
 * Arquivos de chat ficam em: Storage/CHAT/uploads/{YYYY}/{MM}/{DD}/{hash}.ext
 * e são registrados em `_files` com `created_by_fk = req.user.id`.
 */
const CHAT_MODULE = 'CLPP';

/** MIMEs de imagem — mapeiam para type=2 em `cl_message`. */
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function createUseCases() {
    return new ChatUseCases({
        repository: new MysqlChatRepository(),
        eventPublisher: new WsHttpChatEventPublisher()
    });
}

// ─── Handlers REST ────────────────────────────────────────────────────────────

/**
 * Serve um arquivo de chat diretamente pelo Express.
 *
 * Rota pública (sem auth) para que tags <img src="..."> e links de download
 * funcionem sem precisar enviar credenciais. Os nomes de arquivo são o hash
 * SHA-256 do conteúdo (`<hash>.<ext>`), portanto não são adivinháveis.
 *
 * O arquivo físico fica em subpastas por data (`Storage/{MODULO}/uploads/{YYYY}/{MM}/{DD}/`),
 * então o caminho real é resolvido a partir do registro em `_files` (via `FileService`),
 * não de um diretório fixo.
 *
 * @route GET /chat/uploads/:filename
 * @param {import('express').Request}  req - `params.filename` = nome do arquivo (`<hash>.<ext>`).
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>}
 */
async function serveFile(req, res) {
    const filename = path.basename(req.params.filename); // sanitiza path traversal
    const record   = await FileService.findByFilename(filename);
    const filePath = FileService.absolutePath(record);

    res.sendFile(filePath, err => {
        if (err) res.status(404).json({ error: true, message: 'Arquivo não encontrado.' });
    });
}

/**
 * Lista as conversas diretas do usuário autenticado.
 *
 * @route GET /chat/conversations
 * @access Requer `USE_CLPP_CHAT`
 * @param {import('express').Request}  req - Requisição Express (usuário via `req.user.id`).
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com lista de conversas (`partner_id`, `partner_name`, `unread_count`).
 */
async function getConversations(req, res) {
    const useCases = createUseCases();
    const data      = await useCases.getConversations(req.user.id);
    return respond.ok(res, data);
}

/**
 * Retorna mensagens paginadas entre o usuário autenticado e um parceiro.
 *
 * @route GET /chat/messages?with_user_id=:id&page=:n
 * @access Requer `USE_CLPP_CHAT`
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

    const useCases = createUseCases();
    const data      = await useCases.getMessages(req.user.id, partnerId, page);
    return respond.ok(res, data);
}

/**
 * Envia uma mensagem de texto para outro usuário.
 *
 * Após persistir, emite `chat:message` ao destinatário e `chat:delivered` ao remetente via WS.
 *
 * @route POST /chat/messages
 * @access Requer `USE_CLPP_CHAT`
 * @param {import('express').Request}  req - Body: `{ to_user_id, message, type? }`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `201 Created` com a mensagem persistida.
 */
async function sendMessage(req, res) {
    const { to_user_id, message, type } = req.body;

    const useCases = createUseCases();
    const savedMsg = await useCases.sendMessage({
        senderId: req.user.id,
        recipientId: to_user_id,
        message,
        type
    });

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
 * @access Requer `USE_CLPP_CHAT`
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

    // Valida self-send (regra de domínio, mesma usada em sendMessage) antes de
    // gastar I/O salvando o arquivo em disco
    new ChatMessageEntity({ senderId: req.user.id, recipientId: toUserId, message: null });

    // Valida, escaneia, deduplica e salva via FileService centralizado
    const fileRecord = await FileService.save(req.file, CHAT_MODULE, req.user.id);

    // Tipo da mensagem inferido pelo MIME real detectado pelo FileService
    const msgType = IMAGE_MIMES.has(fileRecord.file_type) ? 2 : 3;

    // `message` armazena texto opcional enviado junto com o arquivo
    // `file_name` guarda o snapshot imutável do nome do arquivo
    const useCases = createUseCases();
    const savedMsg = await useCases.sendMessage({
        senderId: req.user.id,
        recipientId: toUserId,
        message: req.body.message ?? null,
        type: msgType,
        fileId: fileRecord.id,
        fileName: req.body.file_name ?? Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    });

    return respond.created(res, savedMsg);
}

/**
 * Marca como lidas todas as mensagens recebidas de um parceiro.
 *
 * @route PUT /chat/messages/read
 * @access Requer `USE_CLPP_CHAT`
 * @param {import('express').Request}  req - Body: `{ partner_id }`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com `{ updated: number }`.
 */
async function markAsRead(req, res) {
    const { partner_id } = req.body;

    const useCases = createUseCases();
    const result    = await useCases.markAsRead(req.user.id, parseInt(partner_id, 10));

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
