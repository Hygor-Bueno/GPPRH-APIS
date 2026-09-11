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
    SQL_GET_ITEM_RESPONSE_FILES,
    SQL_GET_RESPONSE_FILES,
    SQL_FIND_RESPONSE_BY_ID,
    SQL_INSERT_TASK_ITEM_RESPONSE,
    SQL_INSERT_TASK_ITEM_RESPONSE_FILE,
    SQL_SOFT_DELETE_RESPONSE,
    SQL_SOFT_DELETE_RESPONSE_FILE,
    SQL_SOFT_DELETE_FILES_BY_RESPONSE,
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

    async findFilesByItem(taskItemId) {
        const [rows] = await this._query(SQL_GET_ITEM_RESPONSE_FILES, [taskItemId]);
        return rows;
    }

    async findFilesByResponse(responseId) {
        const [rows] = await this._query(SQL_GET_RESPONSE_FILES, [responseId]);
        return rows;
    }

    async findResponseById(responseId) {
        const [[row]] = await this._query(SQL_FIND_RESPONSE_BY_ID, [responseId]);
        return row ?? null;
    }

    async findTaskIdByItemId(itemId) {
        const [[row]] = await this._query(SQL_FIND_TASK_ID_BY_ITEM_ID, [itemId]);
        return row?.task_id ?? null;
    }

    /**
     * 1. Salva cada arquivo via FileService (fora da transação — tem sua própria
     *    gestão: validação de segurança, deduplicação e gravação em disco).
     *    Em série, não em paralelo: a deduplicação por hash lê e grava `_files`,
     *    e dois uploads idênticos concorrentes disputariam a mesma linha.
     * 2. Insere o comentário e um registro por anexo em transação; se falhar,
     *    reverte (rollback) e soft-deleta os arquivos recém-salvos para não
     *    deixar órfãos em `_files`.
     */
    async create(taskItemId, userId, { comment, files = [] }) {
        /** @type {{record: object, name: ?string}[]} */
        const savedFiles = [];

        for (const file of files) {
            const record = await FileService.save(file, GTPP_MODULE, userId);
            savedFiles.push({ record, name: file.originalname ?? record.file_name ?? null });
        }

        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();

            // @deprecated Os dois últimos parâmetros gravam o PRIMEIRO anexo nas
            // colunas legadas `file_id`/`file_name`, mantidas até o front migrar
            // para `files[]`. Remover junto com as colunas.
            const [result] = await conn.execute(SQL_INSERT_TASK_ITEM_RESPONSE, [
                taskItemId,
                comment,
                userId,
                savedFiles[0]?.record?.id ?? null,
                savedFiles[0]?.name ?? null,
            ]);

            const responseId = result.insertId;

            for (const { record, name } of savedFiles) {
                await conn.execute(SQL_INSERT_TASK_ITEM_RESPONSE_FILE, [
                    responseId,
                    record.id,
                    name,
                    userId,
                ]);
            }

            await conn.commit();

            // Relê os anexos já gravados para devolver id e created_at reais.
            const createdFiles = savedFiles.length ? await this.findFilesByResponse(responseId) : [];

            return { responseId, files: createdFiles };
        } catch (error) {
            await conn.rollback();

            for (const { record } of savedFiles) {
                if (!record?.id) continue;
                await FileService.softDelete(record.id, userId).catch(e =>
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

    /** Soft-delete do comentário em transação com a cascata dos seus anexos. */
    async softDelete(responseId, userId) {
        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();

            const [result] = await conn.execute(SQL_SOFT_DELETE_RESPONSE, [responseId]);
            await conn.execute(SQL_SOFT_DELETE_FILES_BY_RESPONSE, [userId ?? null, responseId]);

            await conn.commit();
            return { affectedRows: result.affectedRows };
        } catch (error) {
            await conn.rollback();

            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao excluir resposta.', 500, {
                code: 'GTPP_TASK_ITEM_RESPONSE_MYSQL_ERROR',
                details: error,
            });
        } finally {
            conn.release();
        }
    }

    async softDeleteFile({ attachmentId, responseId, taskItemId, userId }) {
        const [result] = await this._query(SQL_SOFT_DELETE_RESPONSE_FILE, [
            userId ?? null,
            attachmentId,
            responseId,
            taskItemId,
        ]);
        return { affectedRows: result.affectedRows };
    }
}

module.exports = { MysqlTaskItemResponseRepository };
