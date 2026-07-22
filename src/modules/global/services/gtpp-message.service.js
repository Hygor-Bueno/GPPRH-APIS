/**
 * @fileoverview Serviço de mensagens do chat de tarefa GTPP.
 * @module modules/global/services/gtpp-message.service
 */

'use strict';

const { poolGlobal } = require('../../../config/mysql');
const { AppError }   = require('../../../errors/app.error');
const { FileService } = require('../../../utils/file/file.service');
const {
    SQL_GET_TASK_MESSAGES,
    SQL_GET_MESSAGE_BY_ID,
    SQL_INSERT_MESSAGE,
    SQL_UPDATE_MSG_FILE,
    SQL_DELETE_MESSAGE,
} = require('../repositories/mysql/gtpp.repository');

const GTPP_MODULE = 'GTPP';

/**
 * Lista todas as mensagens de uma tarefa.
 * O campo `image` retorna 0 (sem imagem) ou 1 (tem imagem).
 * @param {number} taskId
 */
async function getTaskMessages(taskId) {
    try {
        const [rows] = await poolGlobal.execute(SQL_GET_TASK_MESSAGES, [taskId]);
        return rows;
    } catch (err) {
        throw new AppError('Erro ao buscar mensagens.', 500, err.code, err);
    }
}

/**
 * Envia uma mensagem (texto e/ou arquivo via FileService).
 * @param {number} taskId
 * @param {number} userId
 * @param {{ description?: string, file?: Express.Multer.File }} data
 */
async function sendMessage(taskId, userId, { description, file }) {
    if (!description && !file) {
        throw new AppError('A mensagem precisa ter texto ou arquivo.', 400);
    }

    let savedFile = null;
    if (file) {
        savedFile = await FileService.save(file, GTPP_MODULE, userId);
    }

    try {
        const [result] = await poolGlobal.execute(SQL_INSERT_MESSAGE, [
            description ?? null, taskId, userId,
        ]);

        const messageId = result.insertId;

        if (savedFile) {
            await poolGlobal.execute(SQL_UPDATE_MSG_FILE, [
                savedFile.id, file.originalname, messageId,
            ]);
        }

        const [[message]] = await poolGlobal.execute(SQL_GET_MESSAGE_BY_ID, [messageId]);
        return message;
    } catch (err) {
        if (savedFile?.id) {
            await FileService.softDelete(savedFile.id, userId).catch(e =>
                console.error('[gtpp:message] Falha ao reverter arquivo após erro:', e.message)
            );
        }
        if (err instanceof AppError) throw err;
        throw new AppError('Erro ao enviar mensagem.', 500, err.code, err);
    }
}

/**
 * Remove uma mensagem da tarefa (delete físico, como no PHP original).
 * @param {number} messageId
 * @param {number} taskId
 */
async function deleteMessage(messageId, taskId) {
    try {
        const [result] = await poolGlobal.execute(SQL_DELETE_MESSAGE, [messageId, taskId]);
        if (result.affectedRows === 0) throw new AppError('Mensagem não encontrada.', 404);
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Erro ao excluir mensagem.', 500, err.code, err);
    }
}

module.exports = {
    getTaskMessages,
    sendMessage,
    deleteMessage,
};
