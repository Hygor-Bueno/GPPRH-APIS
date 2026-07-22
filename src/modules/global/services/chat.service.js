/**
 * @fileoverview Serviço de Chat Direto.
 *
 * Centraliza toda a lógica de negócio para mensagens diretas entre usuários,
 * usando a tabela `cl_message` do banco `global`.
 *
 * ⚠️  NOMENCLATURA LEGADA DO BANCO:
 *   - `id_user`   → remetente (sender)
 *   - `id_sender` → destinatário (recipient)
 * Os aliases SQL `sender_id` / `recipient_id` corrigem essa inversão na camada de serviço.
 *
 * @module modules/global/services/chat.service
 */

const { poolGlobal } = require('../../../config/mysql');
const { AppError }   = require('../../../errors/app.error');

const {
    PAGE_SIZE,
    sqlGetConversations,
    sqlCountMessages,
    sqlGetMessages,
    sqlInsertMessage,
    sqlGetMessageById,
    sqlMarkAsRead
} = require('../repositories/mysql/chat.repository');

/**
 * Serviço de Chat Direto.
 *
 * Expõe operações de leitura, envio e marcação de mensagens entre usuários.
 * Mensagens de grupo (`id_group IS NOT NULL`) são ignoradas em todas as operações.
 */
class ChatService {

    // ─── Helper Interno ───────────────────────────────────────────────────────

    /**
     * Obtém uma conexão do pool, executa a query e libera a conexão.
     *
     * @private
     * @param {string}  sql    - Query SQL com `?` como placeholders.
     * @param {any[]}   params - Valores para os placeholders.
     * @returns {Promise<any>} Resultado retornado pelo driver (`rows` ou `ResultSetHeader`).
     * @throws {AppError} Em caso de falha na execução.
     */
    async _execute(sql, params = []) {
        let conn;
        try {
            conn = await poolGlobal.getConnection();
            const [result] = await conn.execute(sql, params);
            return result;
        } finally {
            if (conn) conn.release();
        }
    }

    // ─── Conversas ────────────────────────────────────────────────────────────

    /**
     * Retorna a lista de conversas diretas do usuário.
     *
     * Cada conversa inclui `partner_id`, `partner_name` e `unread_count`
     * (mensagens ainda não lidas enviadas pelo parceiro).
     *
     * @param {number} userId - ID do usuário autenticado.
     * @returns {Promise<Object[]>} Lista de conversas ordenada por nome do parceiro.
     * @throws {AppError} Em caso de falha no banco.
     */
    async getConversations(userId) {
        try {
            // Parâmetros em ordem: outer(id_sender) + inner(IF×4, WHERE×2, IF!=, !=)
            return await this._execute(
                sqlGetConversations(),
                [userId, userId, userId, userId, userId, userId, userId, userId]
            );
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao buscar conversas', 500, 'MYSQL_ERROR', error);
        }
    }

    // ─── Mensagens ────────────────────────────────────────────────────────────

    /**
     * Retorna mensagens paginadas entre dois usuários, do mais recente ao mais antigo.
     *
     * @param {number} userId    - ID do usuário autenticado.
     * @param {number} partnerId - ID do parceiro da conversa.
     * @param {number} [page=1]  - Página solicitada (base 1).
     * @returns {Promise<{messages: Object[], total: number, page: number, pages: number}>}
     *   Objeto com a lista de mensagens e metadados de paginação.
     * @throws {AppError} 400 se `page` for inválida.
     * @throws {AppError} 500 em caso de falha no banco.
     */
    async getMessages(userId, partnerId, page = 1) {
        const pageNum = parseInt(page, 10);
        if (isNaN(pageNum) || pageNum < 1) {
            throw new AppError('Parâmetro `page` inválido.', 400);
        }

        try {
            const baseParams = [userId, partnerId, partnerId, userId];
            const offset     = (pageNum - 1) * PAGE_SIZE;

            const [countRow] = await this._execute(sqlCountMessages(), baseParams);
            const total      = countRow.total;
            const pages      = Math.ceil(total / PAGE_SIZE) || 1;

            // offset é interpolado na SQL (não como parâmetro) para contornar bug
            // do mysql2 com placeholders em LIMIT/OFFSET em prepared statements
            const messages = await this._execute(
                sqlGetMessages(offset),
                baseParams
            );

            return { messages, total, page: pageNum, pages };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao buscar mensagens', 500, 'MYSQL_ERROR', error);
        }
    }

    /**
     * Persiste uma nova mensagem direta e retorna o registro completo após a inserção.
     *
     * A mensagem é marcada como não lida (`notification = 1`) na inserção.
     *
     * @param {number} senderId    - ID do remetente.
     * @param {number} recipientId - ID do destinatário.
     * @param {string} message     - Conteúdo da mensagem (texto ou URL de arquivo).
     * @param {1|2|3} [type=1]       - Tipo: `1` = texto, `2` = imagem, `3` = arquivo.
     * @param {number|null} [fileId=null] - FK para `_files.id` (null em mensagens de texto).
     * @returns {Promise<Object>} Mensagem recém-criada com aliases `sender_id` / `recipient_id`.
     * @throws {AppError} Em caso de falha no banco.
     */
    async sendMessage(senderId, recipientId, message, type = 1, fileId = null, fileName = null) {
        try {
            const result = await this._execute(
                sqlInsertMessage(),
                [senderId, message, recipientId, type, fileId, fileName]
            );

            const rows = await this._execute(sqlGetMessageById(), [result.insertId]);
            return rows[0];
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao enviar mensagem', 500, 'MYSQL_ERROR', error);
        }
    }

    // ─── Notificações ─────────────────────────────────────────────────────────

    /**
     * Marca todas as mensagens recebidas de um parceiro como lidas (`notification = 0`).
     *
     * Semântica DB: `id_user = partnerId` (parceiro é o remetente) e
     * `id_sender = currentUserId` (eu sou o destinatário).
     *
     * @param {number} currentUserId - ID do usuário autenticado (destinatário).
     * @param {number} partnerId     - ID do parceiro (remetente das mensagens a marcar).
     * @returns {Promise<{updated: number}>} Quantidade de mensagens marcadas como lidas.
     * @throws {AppError} Em caso de falha no banco.
     */
    async markAsRead(currentUserId, partnerId) {
        try {
            const result = await this._execute(
                sqlMarkAsRead(),
                [partnerId, currentUserId]
            );
            return { updated: result.affectedRows };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao marcar mensagens como lidas', 500, 'MYSQL_ERROR', error);
        }
    }
}

module.exports = { ChatService };
