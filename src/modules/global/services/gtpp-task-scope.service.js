/**
 * @fileoverview Serviço de escopo de tarefas GTPP.
 * @module modules/global/services/gtpp-task-scope.service
 */

'use strict';

const { poolGlobal } = require('../../../config/mysql');
const { AppError }   = require('../../../errors/app.error');
const {
    SQL_GET_TASK_SCOPE,
    SQL_INSERT_TASK_SCOPE,
    SQL_DELETE_TASK_SCOPE,
} = require('../repositories/mysql/gtpp.repository');

/**
 * Lista os escopos de uma tarefa.
 * @param {number} taskId
 */
async function getTaskScope(taskId) {
    try {
        const [rows] = await poolGlobal.execute(SQL_GET_TASK_SCOPE, [taskId]);
        return rows;
    } catch (err) {
        throw new AppError('Erro ao buscar escopos.', 500, err.code, err);
    }
}

/**
 * Adiciona um escopo à tarefa.
 * Níveis NULL significam "todos" naquele nível.
 *
 * Exemplos:
 *  { company_code: null }                         → todas as companhias
 *  { company_code: '01' }                         → toda a companhia 01
 *  { company_code: '01', branch_code: '0101' }    → toda a loja 0101
 *  { company_code: '01', branch_code: '0101', cost_center_code: 'TI' } → CC específico
 *
 * @param {number} taskId
 * @param {{ company_code?: string, branch_code?: string, cost_center_code?: string }} data
 */
async function addTaskScope(taskId, { company_code, branch_code, cost_center_code }) {
    try {
        const [result] = await poolGlobal.execute(SQL_INSERT_TASK_SCOPE, [
            taskId,
            company_code      ?? null,
            branch_code       ?? null,
            cost_center_code  ?? null,
        ]);
        return { id: result.insertId };
    } catch (err) {
        throw new AppError('Erro ao adicionar escopo.', 500, err.code, err);
    }
}

/**
 * Remove um escopo da tarefa.
 * @param {number} taskId
 * @param {number} scopeId
 */
async function removeTaskScope(taskId, scopeId) {
    try {
        const [result] = await poolGlobal.execute(SQL_DELETE_TASK_SCOPE, [scopeId, taskId]);
        if (result.affectedRows === 0) throw new AppError('Escopo não encontrado.', 404);
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Erro ao remover escopo.', 500, err.code, err);
    }
}

module.exports = { getTaskScope, addTaskScope, removeTaskScope };
