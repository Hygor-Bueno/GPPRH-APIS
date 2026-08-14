/**
 * @fileoverview Adapter MySQL — implementa `TaskItemResponseRepositoryPort`.
 *
 * `FileService` é colaborador direto do adapter (como `poolGlobal`), sem port
 * dedicado — mesma decisão já tomada para Task Item.
 *
 * @module modules/global/infrastructure/gtpp/mysql-task-item-response.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { FileService } = require('../../../../utils/file/file.service');
const { TaskItemResponseRepositoryPort } = require('../../application/gtpp/task-item-response/ports/task-item-response-repository.port');
const {
    SQL_GET_ITEM_RESPONSES,
    SQL_INSERT_TASK_ITEM_RESPONSE,
    SQL_SOFT_DELETE_RESPONSE,
    SQL_UPDATE_RESPONSE,
    SQL_FIND_TASK_ID_BY_ITEM_ID,
} = require('../../repositories/mysql/gtpp-task-item-response.queries');

const GTPP_MODULE = 'GTPP';

class MysqlTaskItemResponseRepository extends TaskItemResponseRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.execute(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GTPP_TASK_ITEM_RESPONSE_MYSQL_ERROR',
                details: error,
            });
        }
    }

    async findByItem(taskItemId) {
        const [rows] = await this._query(SQL_GET_ITEM_RESPONSES, [taskItemId]);
        return rows;
    }

    async findTaskIdByItemId(itemId) {
        const [[row]] = await this._query(SQL_FIND_TASK_ID_BY_ITEM_ID, [itemId]);
        return row?.task_id ?? null;
    }

    /**
     * 1. Salva o arquivo via FileService (fora da transação — tem sua própria
     *    gestão: validação de segurança, deduplicação e gravação em disco).
     * 2. Insere a resposta em transação; se falhar, reverte (rollback) e
     *    soft-deleta o arquivo recém-salvo para não deixar órfão em `_files`.
     */
    async create(taskItemId, userId, { comment, file }) {
        let savedFile = null;
        if (file) {
            savedFile = await FileService.save(file, GTPP_MODULE, userId);
        }

        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();

            const [result] = await conn.execute(SQL_INSERT_TASK_ITEM_RESPONSE, [
                taskItemId,
                comment,
                userId,
                savedFile?.id ?? null,
                file?.originalname ?? null,
            ]);

            await conn.commit();
            return { responseId: result.insertId };
        } catch (error) {
            await conn.rollback();

            if (savedFile?.id) {
                await FileService.softDelete(savedFile.id, userId).catch(e =>
                    console.error('[gtpp:response] Falha ao reverter arquivo após rollback:', e.message)
                );
            }

            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao salvar resposta.', 500, {
                code: 'GTPP_TASK_ITEM_RESPONSE_MYSQL_ERROR',
                details: error,
            });
        } finally {
            conn.release();
        }
    }

    async update(responseId, comment) {
        const [result] = await this._query(SQL_UPDATE_RESPONSE, [comment, responseId]);
        return { affectedRows: result.affectedRows };
    }

    async softDelete(responseId) {
        const [result] = await this._query(SQL_SOFT_DELETE_RESPONSE, [responseId]);
        return { affectedRows: result.affectedRows };
    }
}

module.exports = { MysqlTaskItemResponseRepository };
