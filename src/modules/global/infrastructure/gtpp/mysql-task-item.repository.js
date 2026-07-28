/**
 * @fileoverview Adapter MySQL — implementa `TaskItemRepositoryPort`.
 *
 * `FileService` é colaborador direto do adapter (como `poolGlobal`), sem port
 * dedicado — não há precedente de port para `FileService` em chat/EPP/GAPP.
 *
 * @module modules/global/infrastructure/gtpp/mysql-task-item.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { FileService } = require('../../../../utils/file/file.service');
const { TaskItemRepositoryPort } = require('../../application/gtpp/task-item/ports/task-item-repository.port');
const { SQL_GET_TASK_ITEMS } = require('../../repositories/mysql/gtpp-task.queries');
const {
    SQL_GET_TASK_ITEM_BY_ID,
    SQL_GET_TASK_ITEM_MAX_ORDER,
    SQL_GET_TASK_DATES,
    SQL_INSERT_TASK_ITEM,
    SQL_UPDATE_ITEM_CHECK,
    SQL_UPDATE_ITEM_YES_NO,
    SQL_UPDATE_ITEM_ASSIGNED_TO,
    SQL_UPDATE_ITEM_DESCRIPTION,
    SQL_UPDATE_ITEM_DATES,
    SQL_UPDATE_ITEM_FILE,
    SQL_CLEAR_ITEM_FILE,
    SQL_GET_ITEM_FILE,
    SQL_GET_FILE_METADATA,
    SQL_GET_ITEM_FILE_BLOB,
    SQL_UPDATE_ITEM_NOTE,
    SQL_UPDATE_ITEM_STATUS,
    SQL_SOFT_DELETE_ITEM,
    SQL_UPDATE_ITEM_ORDER,
    SQL_GET_ITEM_PREV,
    SQL_GET_ITEM_NEXT,
} = require('../../repositories/mysql/gtpp-task-item.queries');

const GTPP_MODULE = 'GTPP';

class MysqlTaskItemRepository extends TaskItemRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.execute(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GTPP_TASK_ITEM_MYSQL_ERROR',
                details: error,
            });
        }
    }

    async findByTask(taskId) {
        const [rows] = await this._query(SQL_GET_TASK_ITEMS, [taskId]);
        return rows;
    }

    async findItemById(taskId, itemId) {
        const [[row]] = await this._query(SQL_GET_TASK_ITEM_BY_ID, [itemId, taskId]);
        return row ?? null;
    }

    async findMaxOrder(taskId) {
        const [[{ max_order }]] = await this._query(SQL_GET_TASK_ITEM_MAX_ORDER, [taskId]);
        return Number(max_order) || 0;
    }

    async findTaskDates(taskId) {
        const [[row]] = await this._query(SQL_GET_TASK_DATES, [taskId]);
        return row ?? null;
    }

    async insertItem(taskId, { description, order, yesNo, createdBy, initialDate, finalDate }) {
        const [result] = await this._query(SQL_INSERT_TASK_ITEM, [
            description, taskId, order, yesNo, createdBy, initialDate, finalDate,
        ]);
        return { itemId: result.insertId };
    }

    async attachFile(taskId, itemId, userId, file) {
        const saved = await FileService.save(file, GTPP_MODULE, userId);
        const [result] = await this._query(SQL_UPDATE_ITEM_FILE, [saved.id, file.originalname, itemId, taskId]);
        return { affectedRows: result.affectedRows };
    }

    async clearFile(taskId, itemId) {
        const [result] = await this._query(SQL_CLEAR_ITEM_FILE, [itemId, taskId]);
        return { affectedRows: result.affectedRows };
    }

    /**
     * Estratégia dual (migração progressiva):
     *  1. file_id (novo) → busca metadados em _files, retorna { source: 'files', ...meta }
     *  2. file (legado BLOB) → retorna { source: 'blob' } para o controller servir o BLOB diretamente
     *  3. Nenhum → retorna null
     */
    async findItemFileInfo(itemId) {
        const [[row]] = await this._query(SQL_GET_ITEM_FILE, [itemId]);
        if (!row) return null;

        if (row.file_id) {
            const [[fileRow]] = await this._query(SQL_GET_FILE_METADATA, [row.file_id]);
            return fileRow ? { source: 'files', ...fileRow } : null;
        }

        if (row.file) return { source: 'blob' };

        return null;
    }

    async findItemFileId(taskId, itemId) {
        const [[row]] = await this._query(SQL_GET_ITEM_FILE, [itemId]);
        return row?.file_id ?? null;
    }

    async findItemFileBlob(taskId, itemId) {
        const [[row]] = await this._query(SQL_GET_ITEM_FILE_BLOB, [itemId, taskId]);
        return row?.file ?? null;
    }

    async updateCheck(taskId, itemId, value) {
        const [result] = await this._query(SQL_UPDATE_ITEM_CHECK, [value, itemId, taskId]);
        return { affectedRows: result.affectedRows };
    }

    async updateYesNo(taskId, itemId, yesNo) {
        const [result] = await this._query(SQL_UPDATE_ITEM_YES_NO, [yesNo, itemId, taskId]);
        return { affectedRows: result.affectedRows };
    }

    async updateDescription(taskId, itemId, description) {
        const [result] = await this._query(SQL_UPDATE_ITEM_DESCRIPTION, [description, itemId, taskId]);
        return { affectedRows: result.affectedRows };
    }

    async updateAssignedTo(taskId, itemId, assignedTo) {
        const [result] = await this._query(SQL_UPDATE_ITEM_ASSIGNED_TO, [assignedTo, itemId, taskId]);
        return { affectedRows: result.affectedRows };
    }

    async updateStatus(taskId, itemId, status) {
        const [result] = await this._query(SQL_UPDATE_ITEM_STATUS, [status, itemId, taskId]);
        return { affectedRows: result.affectedRows };
    }

    async updateNote(taskId, itemId, note) {
        const [result] = await this._query(SQL_UPDATE_ITEM_NOTE, [note, itemId, taskId]);
        return { affectedRows: result.affectedRows };
    }

    async updateDates(taskId, itemId, initialDate, finalDate) {
        const [result] = await this._query(SQL_UPDATE_ITEM_DATES, [initialDate, finalDate, itemId, taskId]);
        return { affectedRows: result.affectedRows };
    }

    async softDelete(taskId, itemId) {
        const [result] = await this._query(SQL_SOFT_DELETE_ITEM, [itemId, taskId]);
        return { affectedRows: result.affectedRows };
    }

    async findAdjacentItem(taskId, order, direction) {
        const sql = direction === 'up' ? SQL_GET_ITEM_PREV : SQL_GET_ITEM_NEXT;
        const [[row]] = await this._query(sql, [taskId, order]);
        return row ?? null;
    }

    async updateOrder(itemId, order) {
        await this._query(SQL_UPDATE_ITEM_ORDER, [order, itemId]);
    }
}

module.exports = { MysqlTaskItemRepository };
