/**
 * @fileoverview Adapter MySQL — implementa `MessageRepositoryPort`.
 *
 * `FileService` é colaborador direto do adapter (como `poolGlobal`), sem port
 * dedicado — mesma decisão já tomada para Task Item e Task Item Response.
 *
 * @module modules/global/infrastructure/gtpp/mysql-message.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { FileService } = require('../../../../utils/file/file.service');
const { MessageRepositoryPort } = require('../../application/gtpp/message/ports/message-repository.port');
const {
    SQL_GET_TASK_MESSAGES,
    SQL_GET_MESSAGE_BY_ID,
    SQL_INSERT_MESSAGE,
    SQL_UPDATE_MSG_FILE,
    SQL_DELETE_MESSAGE,
} = require('../../repositories/mysql/gtpp-message.queries');

const GTPP_MODULE = 'GTPP';

class MysqlMessageRepository extends MessageRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.execute(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GTPP_MESSAGE_MYSQL_ERROR',
                details: error,
            });
        }
    }

    async findByTask(taskId) {
        const [rows] = await this._query(SQL_GET_TASK_MESSAGES, [taskId]);
        return rows;
    }

    async send(taskId, userId, { description, file }) {
        let savedFile = null;
        if (file) {
            savedFile = await FileService.save(file, GTPP_MODULE, userId);
        }

        try {
            const [result] = await this._query(SQL_INSERT_MESSAGE, [description ?? null, taskId, userId]);
            const messageId = result.insertId;

            if (savedFile) {
                await this._query(SQL_UPDATE_MSG_FILE, [savedFile.id, file.originalname, messageId]);
            }

            const [[message]] = await this._query(SQL_GET_MESSAGE_BY_ID, [messageId]);
            return message;
        } catch (error) {
            if (savedFile?.id) {
                await FileService.softDelete(savedFile.id, userId).catch(e =>
                    console.error('[gtpp:message] Falha ao reverter arquivo após erro:', e.message)
                );
            }
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao enviar mensagem.', 500, {
                code: 'GTPP_MESSAGE_MYSQL_ERROR',
                details: error,
            });
        }
    }

    async remove(messageId, taskId) {
        const [result] = await this._query(SQL_DELETE_MESSAGE, [messageId, taskId]);
        return { affectedRows: result.affectedRows };
    }
}

module.exports = { MysqlMessageRepository };
