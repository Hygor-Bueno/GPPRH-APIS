/**
 * @fileoverview Serviço de tarefas GTPP.
 * @module modules/global/services/gtpp-task.service
 */

'use strict';

const { poolGlobal } = require('../../../config/mysql');
const { AppError }   = require('../../../errors/app.error');
const {
    buildGetTasksQuery,
    SQL_GET_TASK_USER_ID,
    SQL_GET_TASK_STATE,
    SQL_INSERT_TASK,
    SQL_INSERT_TASK_USER_SELF,
    SQL_UPDATE_TASK_TITLE,
    SQL_UPDATE_TASK_DESCRIPTION,
    SQL_UPDATE_TASK_THEME,
    SQL_DELETE_TASK,
    SQL_AUTO_UPDATE_TASK_STATE,
    SQL_EXTEND_TASK_FINAL_DATE,
    SQL_GET_TASK_ITEMS,
    SQL_GET_TASK_USERS,
    SQL_GET_TASK_DETAIL_USERS,
    SQL_GET_TASK_CSDS,
    SQL_GET_TASK_STATES,
    SQL_INSERT_TASK_HISTORIC,
    SQL_GET_TASK_HISTORIC,
    SQL_COUNT_ITEM_STATS,
} = require('../repositories/mysql/gtpp.repository');

/**
 * Transforma uma linha raw do SQL_GET_TASKS no formato exato do PHP.
 * @param {object} row
 * @returns {object}
 */
function _formatTask(row) {
    const { colabs_raw, ...rest } = row;
    return {
        ...rest,
        percent:      Number(rest.percent     ?? 0),
        theme_id_fk:  Number(rest.theme_id_fk ?? 0),
        users:        Number(rest.users        ?? 0),
        expire:       Number(rest.expire       ?? 0),
        state_id:     Number(rest.state_id),
        priority:     Number(rest.priority     ?? 0),
        user_id:      Number(rest.user_id),
        // colabs: array de { user_id: "NNN" } como o PHP retorna
        colabs: colabs_raw
            ? colabs_raw.split(',').map(uid => ({ user_id: uid }))
            : [],
        csds: [],   // campos de unidade de negócio (não usados nesta versão)
    };
}

/**
 * Lista tarefas onde o usuário é criador ou está vinculado.
 * Formato de resposta compatível com o PHP Task.php (campos: id, percent, colabs, csds…).
 *
 * @param {number} userId
 * @param {object} [opts]
 * @param {number|null} [opts.stateId]  - Filtrar por estado (null = todos)
 * @param {number}      [opts.page]     - Página atual (começa em 1, padrão 1)
 * @param {number}      [opts.limit]    - Itens por página (padrão 50)
 * @returns {Promise<{ data: object[], page: number, limit: number, hasMore: boolean }>}
 */
async function getTasksMobile(userId, { stateId = null, page = 1, limit = 50 } = {}) {
    try {
        const offset = (page - 1) * limit;
        const { sql, extraParams } = buildGetTasksQuery({ stateId, limit, offset });
        // Parâmetros: userId (JOIN), userId (WHERE criador), userId (WHERE vinculado), stateId? (opcional)
        // LIMIT/OFFSET já estão inlinados no SQL pelo buildGetTasksQuery
        const [rows] = await poolGlobal.execute(sql, [userId, userId, userId, ...extraParams]);

        return {
            data:    rows.map(_formatTask),
            page,
            limit,
            hasMore: rows.length === limit,
        };
    } catch (err) {
        throw new AppError('Erro ao buscar tarefas.', 500, err.code, err);
    }
}

/**
 * Retorna o detalhe de uma tarefa no formato exato do PHP:
 * { full_description, task_item, task_user, csds }
 *
 * Espelha a rota PHP: GET /Task.php?id=X
 *
 * @param {number} taskId
 */
async function getTaskById(taskId) {
    try {
        // Busca em paralelo: itens, usuários com foto e unidades de negócio
        const [[taskRows], [rawItems], [rawUsers], [csds]] = await Promise.all([
            poolGlobal.execute(
                `SELECT full_description, state_id FROM gt_task WHERE id = ?`, [taskId]
            ),
            poolGlobal.execute(SQL_GET_TASK_ITEMS, [taskId]),
            poolGlobal.execute(SQL_GET_TASK_DETAIL_USERS, [taskId]),
            poolGlobal.execute(SQL_GET_TASK_CSDS, [taskId]),
        ]);

        const task = taskRows[0];
        if (!task) throw new AppError('Tarefa não encontrada.', 404);

        // Converte itens para o formato PHP:
        //  check: boolean  |  assigned_to: 0 quando null
        const task_item = rawItems.map(item => ({
            ...item,
            check:       Boolean(item.check),
            assigned_to: item.assigned_to ?? 0,
        }));

        // Converte usuários:
        //  photo: Buffer → base64 string (ou mantém string se já for base64)
        const task_user = rawUsers.map(u => ({
            task_id:      u.task_id,
            user_id:      u.user_id,
            status:       Boolean(u.status),
            theme_id_fk:  u.theme_id_fk,
            name:         u.name,
            photo:        u.photo
                ? (Buffer.isBuffer(u.photo) ? u.photo.toString('base64') : u.photo)
                : null,
        }));

        return {
            full_description: task.full_description ?? null,
            state_id:         task.state_id,
            task_item,
            task_user,
            csds,
        };
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Erro ao buscar tarefa.', 500, err.code, err);
    }
}

/**
 * Retorna o user_id do criador de uma tarefa.
 * @param {number} taskId
 * @returns {Promise<number>}
 */
async function getTaskCreatorId(taskId) {
    const [[row]] = await poolGlobal.execute(SQL_GET_TASK_USER_ID, [taskId]);
    if (!row) throw new AppError('Tarefa não encontrada.', 404);
    return row.user_id;
}

/**
 * Retorna o state_id atual de uma tarefa.
 * @param {number} taskId
 * @returns {Promise<number>}
 */
async function getTaskState(taskId) {
    const [[row]] = await poolGlobal.execute(SQL_GET_TASK_STATE, [taskId]);
    if (!row) throw new AppError('Tarefa não encontrada.', 404);
    return row.state_id;
}

/**
 * Verifica se a tarefa pode ser editada (lança AppError se não puder).
 * Estados bloqueados: 5 (bloqueado/expirado), 6 (encerrado), 7 (concluído).
 * @param {number} taskId
 * @returns {Promise<number>} stateId atual
 */
async function verifyTaskEditable(taskId) {
    const stateId = await getTaskState(taskId);
    if ([5, 6, 7, 8].includes(stateId)) {
        throw new AppError('Esta tarefa não pode ser modificada no estado atual.', 400);
    }
    return stateId;
}

/**
 * Cria uma nova tarefa e registra o criador como usuário vinculado.
 *
 * @param {number} userId
 * @param {{
 *   description: string,
 *   priority?: number,
 *   initialDate?: string,
 *   finalDate?: string,
 *   themeId?: number
 * }} data
 */
async function createTask(userId, { description, fullDescription, priority, initialDate, finalDate, themeId }) {
    if (!description || !description.trim()) throw new AppError('O título é obrigatório.', 400);

    const conn = await poolGlobal.getConnection();
    try {
        await conn.beginTransaction();

        const [result] = await conn.execute(SQL_INSERT_TASK, [
            description.trim(),
            fullDescription?.trim() ?? null,
            userId,
            priority    ?? null,
            initialDate ?? null,
            finalDate   ?? null,
        ]);

        const taskId = result.insertId;

        // Registra o criador na tabela gt_task_user (com tema, se fornecido)
        await conn.execute(SQL_INSERT_TASK_USER_SELF, [taskId, userId, themeId ?? null]);

        await conn.commit();
        return { taskId };
    } catch (err) {
        await conn.rollback();
        if (err instanceof AppError) throw err;
        throw new AppError('Erro ao criar tarefa.', 500, err.code, err);
    } finally {
        conn.release();
    }
}

/**
 * Atualiza o estado da tarefa via SP `UpdateStateAndTaskHistory`.
 * @param {number} taskId
 * @param {number} stateId
 * @param {string|null} description
 * @param {number} userId
 */
/**
 * Valida se a transição de estado manual é permitida pelas regras de negócio.
 *
 * Regras:
 *  → 1 (Fazer)    : nenhum item pode estar marcado
 *  → 2 (Fazendo)  : livre
 *  → 3 (Validar)  : todos os itens precisam estar marcados
 *  → 4 (Parado)   : livre
 *  → 5 (Expirado) : apenas MANAGE_GTPP (verificado no controller)
 *  → 6 (Feito)    : estado atual deve ser 3 (Validar)
 *  → 7 (Cancelado): livre
 *  → 8 (Arquivado): estado atual deve ser 6 (Feito)
 *
 * @param {number} taskId
 * @param {number} newStateId
 * @param {number} currentStateId
 */
async function _validateStateTransition(taskId, newStateId, currentStateId) {
    // → 6 (Feito): deve vir do estado 3
    if (newStateId === 6 && currentStateId !== 3) {
        throw new AppError('A tarefa só pode ser marcada como "Feito" a partir do estado "Validar".', 400);
    }

    // → 8 (Arquivado): deve vir do estado 6
    if (newStateId === 8 && currentStateId !== 6) {
        throw new AppError('A tarefa só pode ser arquivada a partir do estado "Feito".', 400);
    }

    // → 1 ou → 3: precisa verificar contagem de itens
    if (newStateId === 1 || newStateId === 3) {
        const [[stats]] = await poolGlobal.execute(SQL_COUNT_ITEM_STATS, [taskId]);
        const total   = Number(stats?.total   ?? 0);
        const checked = Number(stats?.checked ?? 0);

        if (newStateId === 1 && checked > 0) {
            throw new AppError('Desmarque todos os itens antes de reverter para "Fazer".', 400);
        }

        if (newStateId === 3 && (total === 0 || checked < total)) {
            throw new AppError('Marque todos os itens antes de mover para "Validar".', 400);
        }
    }
}

async function updateTaskState(taskId, stateId, description, userId, days) {
    const currentStateId = await getTaskState(taskId);
    await _validateStateTransition(taskId, stateId, currentStateId);

    try {
        await poolGlobal.execute(SQL_AUTO_UPDATE_TASK_STATE, [stateId, taskId]);

        // Estende o prazo se `days` for informado
        if (days && Number(days) > 0) {
            await poolGlobal.execute(SQL_EXTEND_TASK_FINAL_DATE, [Number(days), taskId]);
        }

        await poolGlobal.execute(SQL_INSERT_TASK_HISTORIC, [
            description?.trim() || 'Estado atualizado manualmente',
            stateId,
            taskId,
        ]);
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Erro ao atualizar estado da tarefa.', 500, err.code, err);
    }
}

/**
 * Atualiza o título (description) de uma tarefa.
 * @param {number} taskId
 * @param {string} title
 */
async function updateTaskTitle(taskId, title) {
    if (!title || !title.trim()) throw new AppError('O título não pode ser vazio.', 400);
    try {
        const [result] = await poolGlobal.execute(SQL_UPDATE_TASK_TITLE, [title.trim(), taskId]);
        if (result.affectedRows === 0) throw new AppError('Tarefa não encontrada.', 404);
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Erro ao atualizar título.', 500, err.code, err);
    }
}

/**
 * Atualiza a descrição longa (full_description) de uma tarefa.
 * @param {number} taskId
 * @param {string|null} description
 */
async function updateTaskDescription(taskId, description) {
    try {
        const [result] = await poolGlobal.execute(SQL_UPDATE_TASK_DESCRIPTION, [description ?? null, taskId]);
        if (result.affectedRows === 0) throw new AppError('Tarefa não encontrada.', 404);
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Erro ao atualizar descrição.', 500, err.code, err);
    }
}

/**
 * Atualiza o tema de um usuário em uma tarefa.
 * O tema é armazenado por usuário/tarefa em gt_task_user.theme_id_fk.
 * @param {number} taskId
 * @param {number|null} themeId
 * @param {number} userId
 */
async function updateTaskTheme(taskId, themeId, userId) {
    try {
        const [result] = await poolGlobal.execute(SQL_UPDATE_TASK_THEME, [themeId ?? null, taskId, userId]);
        if (result.affectedRows === 0) throw new AppError('Vínculo usuário/tarefa não encontrado.', 404);
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Erro ao atualizar tema.', 500, err.code, err);
    }
}

/**
 * Lista o histórico de uma tarefa em ordem decrescente.
 * @param {number} taskId
 */
async function getTaskHistoric(taskId) {
    try {
        const [rows] = await poolGlobal.execute(SQL_GET_TASK_HISTORIC, [taskId]);
        return rows;
    } catch (err) {
        throw new AppError('Erro ao buscar histórico.', 500, err.code, err);
    }
}

/**
 * Lista todos os estados de tarefa disponíveis.
 * Equivalente ao TaskState.php do PHP.
 * @returns {Promise<Array<{ id: number, description: string, color: string }>>}
 */
async function getTaskStates() {
    try {
        const [rows] = await poolGlobal.execute(SQL_GET_TASK_STATES);
        return rows;
    } catch (err) {
        throw new AppError('Erro ao buscar estados.', 500, err.code, err);
    }
}

/**
 * Remove permanentemente uma tarefa.
 * @param {number} taskId
 */
async function deleteTask(taskId) {
    try {
        const [result] = await poolGlobal.execute(SQL_DELETE_TASK, [taskId]);
        if (result.affectedRows === 0) throw new AppError('Tarefa não encontrada.', 404);
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Erro ao excluir tarefa.', 500, err.code, err);
    }
}

/**
 * Retorna tarefas de múltiplos estados em paralelo para o board do GTPP.
 *
 * @param {number}   userId
 * @param {number[]} stateIds - Lista de state_ids (máx. 10)
 * @param {number}   page
 * @param {number}   limit
 * @returns {Promise<Record<number, { data: object[], page: number, limit: number, hasMore: boolean }>>}
 */
async function getTasksBoard(userId, { stateIds, page = 1, limit = 20 }) {
    const results = await Promise.all(
        stateIds.map(stateId => getTasksMobile(userId, { stateId, page, limit }))
    );

    const board = {};
    stateIds.forEach((stateId, i) => {
        board[stateId] = results[i];
    });

    return board;
}

module.exports = {
    getTaskStates,
    getTaskHistoric,
    getTasksMobile,
    getTasksBoard,
    getTaskById,
    getTaskCreatorId,
    getTaskState,
    verifyTaskEditable,
    createTask,
    updateTaskState,
    updateTaskTitle,
    updateTaskDescription,
    updateTaskTheme,
    deleteTask,
};
