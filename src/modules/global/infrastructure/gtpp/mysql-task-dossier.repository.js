/**
 * @fileoverview Adapter MySQL — implementa `TaskDossierRepositoryPort`.
 *
 * As consultas do dossiê rodam em sequência numa ÚNICA conexão do pool: são
 * nove leituras curtas, e abri-las em paralelo tomaria nove conexões de um
 * `poolGlobal` que divide o teto do servidor com o resto da API.
 *
 * @module modules/global/infrastructure/gtpp/mysql-task-dossier.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { TaskDossierRepositoryPort } = require('../../application/gtpp/task-dossier/ports/task-dossier-repository.port');
const { GtppDossierErrorCode } = require('../../domain/gtpp/task-dossier/task-dossier.enums');
const { computeDeadlinePercent } = require('../../domain/gtpp/task-item/item-deadline-percent.rules');
const {
    SQL_DOSSIER_TASK,
    SQL_DOSSIER_VIEWER,
    SQL_DOSSIER_PARTICIPANTS,
    SQL_DOSSIER_ITEMS,
    SQL_DOSSIER_RESPONSES,
    SQL_DOSSIER_RESPONSE_FILES,
    buildDossierMessagesQuery,
    SQL_DOSSIER_MESSAGES_COUNT,
} = require('../../repositories/mysql/gtpp-task-dossier.queries');
const { SQL_GET_TASK_HISTORIC, SQL_GET_TASK_CSDS } = require('../../repositories/mysql/gtpp-task.queries');
const { SQL_GET_TASK_SCOPE } = require('../../repositories/mysql/gtpp-task-scope.queries');

function toMysqlError(error) {
    if (error instanceof AppError) return error;
    return new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
        code: GtppDossierErrorCode.MYSQL_ERROR,
        details: error,
    });
}

class MysqlTaskDossierRepository extends TaskDossierRepositoryPort {
    async findDossierData(taskId, { messageLimit }) {
        let conn;
        try {
            conn = await poolGlobal.getConnection();
            const q = async (sql, params) => (await conn.execute(sql, params))[0];

            const [task] = await q(SQL_DOSSIER_TASK, [taskId]);
            if (!task) return null;

            const participants  = await q(SQL_DOSSIER_PARTICIPANTS, [taskId, taskId]);
            const rawItems      = await q(SQL_DOSSIER_ITEMS, [taskId]);
            const responses     = await q(SQL_DOSSIER_RESPONSES, [taskId]);
            const responseFiles = await q(SQL_DOSSIER_RESPONSE_FILES, [taskId]);
            const messages      = await q(buildDossierMessagesQuery(messageLimit), [taskId]);
            const [{ total }]   = await q(SQL_DOSSIER_MESSAGES_COUNT, [taskId]);
            const history       = await q(SQL_GET_TASK_HISTORIC, [taskId]);
            const scope         = await q(SQL_GET_TASK_SCOPE, [taskId]);
            const legacyScope   = scope.length ? [] : await q(SQL_GET_TASK_CSDS, [taskId]);

            const now = new Date();
            const items = rawItems.map(item => ({
                ...item,
                deadline_percent: computeDeadlinePercent(item.deadline_percent, item.initial_date, item.final_date, now),
            }));

            return {
                task, participants, items, responses, responseFiles,
                messages, messagesTotal: Number(total), history, scope, legacyScope,
            };
        } catch (error) {
            throw toMysqlError(error);
        } finally {
            if (conn) conn.release();
        }
    }

    async findViewer(userId) {
        try {
            const [[row]] = await poolGlobal.execute(SQL_DOSSIER_VIEWER, [userId]);
            return row ? { id: Number(row.id), name: row.name } : null;
        } catch (error) {
            throw toMysqlError(error);
        }
    }
}

module.exports = { MysqlTaskDossierRepository };
