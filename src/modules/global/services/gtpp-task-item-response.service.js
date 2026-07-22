/**
 * @fileoverview Serviço de respostas/evidências de itens de tarefa GTPP.
 * @module modules/global/services/gtpp-task-item-response.service
 */

'use strict';

const { poolGlobal }  = require('../../../config/mysql');
const { AppError }    = require('../../../errors/app.error');
const { FileService } = require('../../../utils/file/file.service');
const {
    SQL_GET_ITEM_RESPONSES,
    SQL_INSERT_TASK_ITEM_RESPONSE,
    SQL_SOFT_DELETE_RESPONSE,
    SQL_UPDATE_RESPONSE,
} = require('../repositories/mysql/gtpp.repository');

const GTPP_MODULE = 'GTPP';

/**
 * Lista todas as respostas ativas de um item.
 * @param {number} taskItemId
 */
async function getItemResponses(taskItemId) {
    try {
        const [rows] = await poolGlobal.execute(SQL_GET_ITEM_RESPONSES, [taskItemId]);
        return rows;
    } catch (err) {
        throw new AppError('Erro ao buscar respostas.', 500, err.code, err);
    }
}

/**
 * Cria uma resposta/evidência para um item de tarefa.
 *
 * Chama `sp_InsertTaskItemResponse(task_id, task_item_id, comment, file_id, user_id, last_state_id, new_state_id, user_id_2)`.
 *
 * @param {number} taskId
 * @param {number} taskItemId
 * @param {number} userId
 * @param {{
 *   comment: string,
 *   file?: Express.Multer.File,
 *   lastStateId?: number|null,
 *   newStateId?: number|null
 * }} data
 */
async function createItemResponse(taskId, taskItemId, userId, { comment, file }) {
    if (!comment || !comment.trim()) throw new AppError('O comentário é obrigatório.', 400);

    // 1. Salva o arquivo via FileService (fora da transação — tem sua própria gestão,
    //    inclui validação de segurança, deduplicação e gravação em disco).
    let savedFile = null;
    if (file) {
        savedFile = await FileService.save(file, GTPP_MODULE, userId);
    }

    // 2. Insere a resposta em transação.
    //    Se falhar → rollback + soft-delete do arquivo recém-salvo (evita órfão em _files).
    const conn = await poolGlobal.getConnection();
    try {
        await conn.beginTransaction();

        const [result] = await conn.execute(SQL_INSERT_TASK_ITEM_RESPONSE, [
            taskItemId,
            comment.trim(),
            userId,
            savedFile?.id   ?? null,
            file?.originalname ?? null,
        ]);

        await conn.commit();
        return { responseId: result.insertId };
    } catch (err) {
        await conn.rollback();

        // Remove o registro em _files se o arquivo havia sido salvo nesta operação
        if (savedFile?.id) {
            await FileService.softDelete(savedFile.id, userId).catch(e =>
                console.error('[gtpp:response] Falha ao reverter arquivo após rollback:', e.message)
            );
        }

        if (err instanceof AppError) throw err;
        throw new AppError('Erro ao salvar resposta.', 500, err.code, err);
    } finally {
        conn.release();
    }
}

/**
 * Atualiza o comentário de uma resposta.
 * @param {number} responseId
 * @param {string} comment
 */
async function updateItemResponse(responseId, comment) {
    if (!comment || !comment.trim()) throw new AppError('O comentário é obrigatório.', 400);
    try {
        const [result] = await poolGlobal.execute(SQL_UPDATE_RESPONSE, [comment.trim(), responseId]);
        if (result.affectedRows === 0) throw new AppError('Resposta não encontrada ou já excluída.', 404);
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Erro ao atualizar resposta.', 500, err.code, err);
    }
}

/**
 * Soft-delete de uma resposta (status = 0).
 * @param {number} responseId
 */
async function deleteItemResponse(responseId) {
    try {
        const [result] = await poolGlobal.execute(SQL_SOFT_DELETE_RESPONSE, [responseId]);
        if (result.affectedRows === 0) throw new AppError('Resposta não encontrada.', 404);
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Erro ao excluir resposta.', 500, err.code, err);
    }
}

module.exports = {
    getItemResponses,
    createItemResponse,
    updateItemResponse,
    deleteItemResponse,
};
