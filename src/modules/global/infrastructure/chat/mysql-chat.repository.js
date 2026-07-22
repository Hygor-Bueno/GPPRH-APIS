/**
 * @fileoverview Adapter MySQL — implementa `ChatRepositoryPort`.
 *
 * Reaproveita os builders de SQL puro existentes em
 * `repositories/mysql/chat.repository.js` (inalterados) e passa a possuir o
 * ciclo de vida da conexão (`poolGlobal.getConnection()/execute()/release()`),
 * que antes morava em `services/chat.service.js`.
 *
 * @module modules/global/infrastructure/chat/mysql-chat.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { ChatRepositoryPort } = require('../../application/chat/ports/chat-repository.port');
const {
    PAGE_SIZE,
    sqlGetConversations,
    sqlCountMessages,
    sqlGetMessages,
    sqlInsertMessage,
    sqlGetMessageById,
    sqlMarkAsRead
} = require('../../repositories/mysql/chat.repository');

class MysqlChatRepository extends ChatRepositoryPort {
    constructor() {
        super(PAGE_SIZE);
    }

    /**
     * @private
     * @param {string} sql
     * @param {any[]} [params]
     */
    async _execute(sql, params = []) {
        let conn;
        try {
            conn = await poolGlobal.getConnection();
            const [result] = await conn.execute(sql, params);
            return result;
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'CHAT_MYSQL_ERROR',
                details: error
            });
        } finally {
            if (conn) conn.release();
        }
    }

    async findConversations(userId) {
        // Parâmetros em ordem: outer(id_sender) + inner(IF×4, WHERE×2, IF!=, !=)
        return this._execute(
            sqlGetConversations(),
            [userId, userId, userId, userId, userId, userId, userId, userId]
        );
    }

    async countMessages(userId, partnerId) {
        const [countRow] = await this._execute(sqlCountMessages(), [userId, partnerId, partnerId, userId]);
        return countRow.total;
    }

    async findMessages(userId, partnerId, offset) {
        // offset é interpolado na SQL (não como parâmetro) para contornar bug
        // do mysql2 com placeholders em LIMIT/OFFSET em prepared statements
        return this._execute(sqlGetMessages(offset), [userId, partnerId, partnerId, userId]);
    }

    async insertMessage(entity) {
        return this._execute(
            sqlInsertMessage(),
            [entity.senderId, entity.message, entity.recipientId, entity.type, entity.fileId, entity.fileName]
        );
    }

    async findMessageById(id) {
        const rows = await this._execute(sqlGetMessageById(), [id]);
        return rows[0];
    }

    async markAsRead(currentUserId, partnerId) {
        const result = await this._execute(sqlMarkAsRead(), [partnerId, currentUserId]);
        return { updated: result.affectedRows };
    }
}

module.exports = { MysqlChatRepository };
