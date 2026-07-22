/**
 * @fileoverview Serviço de itens de tarefa GTPP.
 * @module modules/global/services/gtpp-task-item.service
 */

'use strict';

const { poolGlobal }         = require('../../../config/mysql');
const { AppError }           = require('../../../errors/app.error');
const { FileService }        = require('../../../utils/file/file.service');
const { broadcastGtppEvent } = require('../../../websocket/events/gtpp.event');
const {
    SQL_GET_TASK_ITEMS,
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
    SQL_UPDATE_ITEM_NOTE,
    SQL_UPDATE_ITEM_STATUS,
    SQL_SOFT_DELETE_ITEM,
    SQL_UPDATE_ITEM_ORDER,
    SQL_GET_ITEM_PREV,
    SQL_GET_ITEM_NEXT,
    SQL_COUNT_ITEM_STATS,
    SQL_UPDATE_TASK_STATE,
    SQL_AUTO_UPDATE_TASK_STATE,
    SQL_INSERT_TASK_HISTORIC,
    SQL_GET_TASK_STATE,
} = require('../repositories/mysql/gtpp.repository');

const GTPP_MODULE = 'GTPP';

// ─── Helpers de data ──────────────────────────────────────────────────────────

/**
 * Valida e normaliza uma data no formato YYYY-MM-DD.
 * @param {string} value
 * @param {string} fieldName
 * @returns {string}
 */
function _parseDate(value, fieldName) {
    const d = new Date(value);
    if (isNaN(d.getTime())) throw new AppError(`Data inválida para "${fieldName}". Use o formato YYYY-MM-DD.`, 400);
    return value;
}

/**
 * Valida as datas do item contra a tarefa pai e entre si.
 * @param {string|null} initialDate
 * @param {string|null} finalDate
 * @param {{ initial_date: string|null, final_date: string|null }} taskDates
 */
function _validateItemDates(initialDate, finalDate, taskDates) {
    if (!initialDate && !finalDate) return;

    if (!initialDate || !finalDate) {
        throw new AppError('initial_date e final_date devem ser informados juntos.', 400);
    }

    if (initialDate >= finalDate) {
        throw new AppError('A data de início do item deve ser anterior à data de fim.', 400);
    }

    if (taskDates.initial_date && initialDate < taskDates.initial_date) {
        throw new AppError(
            `A data de início do item (${initialDate}) não pode ser anterior à data de início da tarefa (${taskDates.initial_date}).`,
            400
        );
    }

    if (taskDates.final_date && finalDate > taskDates.final_date) {
        throw new AppError(
            `A data de fim do item (${finalDate}) não pode ultrapassar a data de fim da tarefa (${taskDates.final_date}).`,
            400
        );
    }
}

// ─── Helpers de estado automático ────────────────────────────────────────────

async function _getTaskStateRaw(taskId) {
    const [[row]] = await poolGlobal.execute(SQL_GET_TASK_STATE, [taskId]);
    return row?.state_id ?? null;
}

/**
 * Gerencia todas as transições automáticas de estado baseadas no progresso dos checks.
 *
 * Mapa completo:
 *  estado 1 + algum item marcado          → 2  (tarefa iniciada)
 *  estado 2 + nenhum item marcado         → 1  (tarefa revertida para pendente)
 *  estado 2 + todos os itens marcados     → 3  (aguardando análise)
 *  estado 3 + nem todos os itens marcados → 2  (item reaberto)
 *
 * Usa UPDATE direto (não a SP) pois qualquer participante pode disparar estas
 * transições, independente de ser o criador da tarefa.
 * Dispara WS tipo 6 quando a transição ocorre.
 */
async function _autoToggleAnalyzing(taskId, userId) {
    try {
        const stateId = await _getTaskStateRaw(taskId);
        if (![1, 2, 3].includes(stateId)) return;

        const [[stats]] = await poolGlobal.execute(SQL_COUNT_ITEM_STATS, [taskId]);
        const total      = Number(stats?.total   ?? 0);
        const checked    = Number(stats?.checked ?? 0);
        const allChecked = total > 0 && total === checked;
        const noneChecked = checked === 0;

        let newStateId = null;
        let histDesc   = null;

        if      (stateId === 1 && !noneChecked)          { newStateId = 2; histDesc = 'Tarefa iniciada — primeiro item concluído'; }
        else if (stateId === 2 && noneChecked)            { newStateId = 1; histDesc = 'Todos os itens desmarcados — tarefa revertida para pendente'; }
        else if (stateId === 2 && allChecked)             { newStateId = 3; histDesc = 'Todos os itens concluídos — aguardando análise'; }
        else if (stateId === 3 && !allChecked)            { newStateId = 2; histDesc = 'Item reaberto — tarefa retornou para em andamento'; }

        if (newStateId !== null) {
            await poolGlobal.execute(SQL_AUTO_UPDATE_TASK_STATE, [newStateId, taskId]);
            await poolGlobal.execute(SQL_INSERT_TASK_HISTORIC, [histDesc, newStateId, taskId]);
            broadcastGtppEvent(taskId, userId, 6, { action: 'updated', state_id: newStateId, auto: true }).catch(() => {});
            console.log(`[gtpp:autoToggleAnalyzing] task_id=${taskId} ${stateId} → ${newStateId}`);
        }
    } catch (err) {
        console.error('[gtpp:autoToggleAnalyzing] Failed to auto-toggle state:', err.message);
    }
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Lista todos os itens ativos de uma tarefa.
 * @param {number} taskId
 */
async function getTaskItems(taskId) {
    try {
        const [rows] = await poolGlobal.execute(SQL_GET_TASK_ITEMS, [taskId]);
        return rows;
    } catch (err) {
        throw new AppError('Erro ao buscar itens da tarefa.', 500, err.code, err);
    }
}

/**
 * Busca um item pelo ID, garantindo que pertence à tarefa.
 * @param {number} taskId
 * @param {number} itemId
 */
async function getItemById(taskId, itemId) {
    const [[row]] = await poolGlobal.execute(SQL_GET_TASK_ITEM_BY_ID, [itemId, taskId]);
    if (!row) throw new AppError('Item não encontrado.', 404);
    return row;
}

/**
 * Cria um item na tarefa. Aceita arquivo e nota opcionais.
 * O arquivo é gravado via FileService e o ID (_files.id) fica na coluna `file` do item.
 * @param {number} taskId
 * @param {number} userId
 * @param {{ description: string, file?: Express.Multer.File, note?: string }} data
 */
async function createTaskItem(taskId, userId, { description, file, note, yesNo, initialDate, finalDate }) {
    if (!description || !description.trim()) throw new AppError('A descrição é obrigatória.', 400);

    // yes_no: -1 = questão ativa (padrão), 0 = item comum, 1 = sim, 2 = não
    const yesNoValue = yesNo !== undefined ? Number(yesNo) : -1;

    // Valida datas do item contra a tarefa pai (quando informadas)
    const parsedInitial = initialDate ? _parseDate(initialDate, 'initial_date') : null;
    const parsedFinal   = finalDate   ? _parseDate(finalDate,   'final_date')   : null;
    if (parsedInitial || parsedFinal) {
        const [[taskDates]] = await poolGlobal.execute(SQL_GET_TASK_DATES, [taskId]);
        _validateItemDates(parsedInitial, parsedFinal, taskDates ?? {});
    }

    try {
        const [[{ max_order }]] = await poolGlobal.execute(SQL_GET_TASK_ITEM_MAX_ORDER, [taskId]);
        const newOrder = (Number(max_order) || 0) + 1;

        // INSERT: description, task_id, order, yes_no, created_by, initial_date, final_date
        const [result] = await poolGlobal.execute(SQL_INSERT_TASK_ITEM, [
            description.trim(),
            taskId,
            newOrder,
            yesNoValue,
            userId,
            parsedInitial,
            parsedFinal,
        ]);

        const itemId = result.insertId;

        // Arquivo e nota são gravados em updates separados (como no PHP)
        if (file) {
            const saved = await FileService.save(file, GTPP_MODULE, userId);
            await poolGlobal.execute(SQL_UPDATE_ITEM_FILE, [saved.id, file.originalname, itemId, taskId]);
        }
        if (note) {
            await poolGlobal.execute(SQL_UPDATE_ITEM_NOTE, [note, itemId, taskId]);
        }

        // Se tarefa estava em "Validar" (3), novo item desmarcado reverte para "Fazendo" (2)
        await _autoToggleAnalyzing(taskId, userId);

        return { itemId };
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Erro ao criar item.', 500, err.code, err);
    }
}

/**
 * Marca/desmarca um item (check).
 * @param {number} taskId
 * @param {number} itemId
 * @param {0|1} checkValue
 * @param {number} userId
 */
async function updateItemCheck(taskId, itemId, checkValue, userId) {
    const value = checkValue ? 1 : 0;
    const [result] = await poolGlobal.execute(SQL_UPDATE_ITEM_CHECK, [value, itemId, taskId]);
    if (result.affectedRows === 0) throw new AppError('Item não encontrado.', 404);
    await _autoToggleAnalyzing(taskId, userId);
}

/**
 * Atualiza o campo yes_no de um item.
 * Valores: -1 = ativo/não respondido, 0 = desativado, 1 = sim, 2 = não.
 * @param {number} taskId
 * @param {number} itemId
 * @param {-1|0|1|2} yesNo
 * @param {number} userId
 */
async function updateItemYesNo(taskId, itemId, yesNo, userId) {
    const [result] = await poolGlobal.execute(SQL_UPDATE_ITEM_YES_NO, [yesNo, itemId, taskId]);
    if (result.affectedRows === 0) throw new AppError('Item não encontrado.', 404);
    await _autoToggleAnalyzing(taskId, userId);
}

/**
 * Atualiza a descrição de um item.
 * @param {number} taskId
 * @param {number} itemId
 * @param {string} description
 */
async function updateItemDescription(taskId, itemId, description) {
    if (!description || !description.trim()) throw new AppError('A descrição é obrigatória.', 400);
    const [result] = await poolGlobal.execute(SQL_UPDATE_ITEM_DESCRIPTION, [description.trim(), itemId, taskId]);
    if (result.affectedRows === 0) throw new AppError('Item não encontrado.', 404);
}

/**
 * Atualiza o arquivo anexado a um item.
 * Salva o arquivo em _files via FileService e grava o ID na coluna `file` do item.
 * Se file for null, limpa o arquivo do item.
 * @param {number} taskId
 * @param {number} itemId
 * @param {number} userId
 * @param {Express.Multer.File|null} file
 */
async function updateItemFile(taskId, itemId, userId, file) {
    if (file) {
        const saved = await FileService.save(file, GTPP_MODULE, userId);
        const [result] = await poolGlobal.execute(SQL_UPDATE_ITEM_FILE, [saved.id, file.originalname, itemId, taskId]);
        if (result.affectedRows === 0) throw new AppError('Item não encontrado.', 404);
    } else {
        const [result] = await poolGlobal.execute(SQL_CLEAR_ITEM_FILE, [itemId, taskId]);
        if (result.affectedRows === 0) throw new AppError('Item não encontrado.', 404);
    }
}

/**
 * Retorna os metadados do arquivo anexado a um item.
 *
 * Estratégia dual (migração progressiva):
 *  1. file_id (novo) → busca metadados em _files, retorna { source: 'files', ...meta }
 *  2. file (legado BLOB) → retorna { source: 'blob' } para o controller servir o BLOB diretamente
 *  3. Nenhum → retorna null
 *
 * @param {number} itemId
 * @returns {Promise<{ source: 'files'|'blob', file_path?, file_name?, file_extension?, file_type?, file_size? }|null>}
 */
async function getItemFileInfo(itemId) {
    const [[row]] = await poolGlobal.execute(SQL_GET_ITEM_FILE, [itemId]);
    if (!row) return null;

    // Novo sistema: file_id é FK para _files
    if (row.file_id) {
        const [[fileRow]] = await poolGlobal.execute(
            `SELECT file_path, file_name, file_extension, file_type, file_size FROM _files WHERE id = ?`,
            [row.file_id]
        );
        return fileRow ? { source: 'files', ...fileRow } : null;
    }

    // Legado: BLOB direto na coluna file (somente leitura histórica)
    if (row.file) {
        return { source: 'blob' };
    }

    return null;
}

/**
 * Atualiza a observação de um item.
 * @param {number} taskId
 * @param {number} itemId
 * @param {string|null} note
 */
async function updateItemNote(taskId, itemId, note) {
    const [result] = await poolGlobal.execute(SQL_UPDATE_ITEM_NOTE, [note ?? null, itemId, taskId]);
    if (result.affectedRows === 0) throw new AppError('Item não encontrado.', 404);
}

/**
 * Atualiza o responsável pelo item.
 * @param {number} taskId
 * @param {number} itemId
 * @param {number|null} assignedTo
 */
async function updateItemAssignedTo(taskId, itemId, assignedTo) {
    const [result] = await poolGlobal.execute(SQL_UPDATE_ITEM_ASSIGNED_TO, [assignedTo ?? null, itemId, taskId]);
    if (result.affectedRows === 0) throw new AppError('Item não encontrado.', 404);
}

/**
 * Atualiza o status de um item (ex: ativar/desativar sem soft-delete).
 * @param {number} taskId
 * @param {number} itemId
 * @param {number} status
 */
async function updateItemStatus(taskId, itemId, status) {
    const [result] = await poolGlobal.execute(SQL_UPDATE_ITEM_STATUS, [status, itemId, taskId]);
    if (result.affectedRows === 0) throw new AppError('Item não encontrado.', 404);
}

/**
 * Move um item para cima ou para baixo na lista (troca order com o adjacente).
 * @param {number} taskId
 * @param {number} itemId
 * @param {'up'|'down'} direction
 */
async function updateItemPosition(taskId, itemId, direction) {
    const item = await getItemById(taskId, itemId);

    const sql = direction === 'up' ? SQL_GET_ITEM_PREV : SQL_GET_ITEM_NEXT;
    const [[adjacent]] = await poolGlobal.execute(sql, [taskId, item.order]);

    if (!adjacent) {
        throw new AppError('Não é possível mover o item nesta direção.', 400);
    }

    // Troca as posições
    await poolGlobal.execute(SQL_UPDATE_ITEM_ORDER, [adjacent.order, itemId]);
    await poolGlobal.execute(SQL_UPDATE_ITEM_ORDER, [item.order, adjacent.id]);
}

/**
 * Retorna o file_id do arquivo novo vinculado ao item (para uso no FileService.findById).
 * @param {number} taskId
 * @param {number} itemId
 * @returns {Promise<number>}
 */
async function getItemFileId(taskId, itemId) {
    const [[row]] = await poolGlobal.execute(SQL_GET_ITEM_FILE, [itemId]);
    if (!row?.file_id) throw new AppError('Arquivo não encontrado.', 404);
    return row.file_id;
}

/**
 * Retorna o conteúdo BLOB legado de um item (somente leitura histórica).
 * @param {number} taskId
 * @param {number} itemId
 * @returns {Promise<Buffer|null>}
 */
async function getItemFileBlob(taskId, itemId) {
    const [[row]] = await poolGlobal.execute(
        `SELECT file FROM gt_task_item WHERE id = ? AND task_id = ?`,
        [itemId, taskId]
    );
    return row?.file ?? null;
}

/**
 * Atualiza as datas de prazo de um item.
 * Ambos os campos são obrigatórios juntos; envie null em ambos para limpar.
 * @param {number} taskId
 * @param {number} itemId
 * @param {string|null} initialDate - YYYY-MM-DD
 * @param {string|null} finalDate   - YYYY-MM-DD
 */
async function updateItemDates(taskId, itemId, initialDate, finalDate) {
    const parsedInitial = initialDate ? _parseDate(initialDate, 'initial_date') : null;
    const parsedFinal   = finalDate   ? _parseDate(finalDate,   'final_date')   : null;

    if (parsedInitial || parsedFinal) {
        const [[taskDates]] = await poolGlobal.execute(SQL_GET_TASK_DATES, [taskId]);
        _validateItemDates(parsedInitial, parsedFinal, taskDates ?? {});
    }

    const [result] = await poolGlobal.execute(SQL_UPDATE_ITEM_DATES, [parsedInitial, parsedFinal, itemId, taskId]);
    if (result.affectedRows === 0) throw new AppError('Item não encontrado.', 404);
}

/**
 * Soft-delete de um item (status = 0).
 * @param {number} taskId
 * @param {number} itemId
 * @param {number} userId
 */
async function deleteTaskItem(taskId, itemId, userId) {
    const [result] = await poolGlobal.execute(SQL_SOFT_DELETE_ITEM, [itemId, taskId]);
    if (result.affectedRows === 0) throw new AppError('Item não encontrado.', 404);
    await _autoToggleAnalyzing(taskId, userId);
}

module.exports = {
    getTaskItems,
    getItemById,
    createTaskItem,
    updateItemCheck,
    updateItemYesNo,
    updateItemDescription,
    updateItemDates,
    updateItemFile,
    getItemFileInfo,
    getItemFileId,
    getItemFileBlob,
    updateItemNote,
    updateItemAssignedTo,
    updateItemStatus,
    updateItemPosition,
    deleteTaskItem,
};
