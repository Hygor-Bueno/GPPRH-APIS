/**
 * @fileoverview Controller de tarefas GTPP.
 * @module modules/global/controllers/gtpp-task.controller
 */

'use strict';

const { AppError } = require('../../../errors/app.error');
const { respond } = require('../../../utils/respond');
const { GtppTaskUseCases } = require('../application/gtpp/task/gtpp-task.use-cases');
const { MysqlTaskRepository } = require('../infrastructure/gtpp/mysql-task.repository');
const { MysqlGtppTaskGuardRepository } = require('../infrastructure/gtpp/mysql-gtpp-task-guard.repository');
const { HttpGtppEventPublisher } = require('../infrastructure/gtpp/http-gtpp-event.publisher');

const useCases = new GtppTaskUseCases({
    repository: new MysqlTaskRepository(),
    taskGuardRepository: new MysqlGtppTaskGuardRepository(),
    eventPublisher: new HttpGtppEventPublisher(),
});

/**
 * GET /gtpp/tasks/:taskId/historic
 * Lista o histórico de mudanças de estado de uma tarefa.
 */
async function getTaskHistoric(req, res) {
    const taskId = parseInt(req.params.taskId, 10);
    const historic = await useCases.getTaskHistoric(taskId);
    return respond.ok(res, historic);
}

/**
 * GET /gtpp/states
 * Lista todos os estados de tarefa disponíveis.
 * Equivalente ao TaskState.php do PHP.
 */
async function getTaskStates(req, res) {
    const states = await useCases.getTaskStates();
    return respond.ok(res, states);
}

/**
 * GET /gtpp/tasks
 * Lista tarefas onde o usuário é criador ou está vinculado.
 *
 * Query params:
 *  - state_id : number  (opcional) — filtra por estado da tarefa
 *  - page     : number  (opcional, padrão 1)
 *  - limit    : number  (opcional, padrão 50)
 *
 * Resposta: { data: Task[], page, limit, hasMore }
 */
async function getTasks(req, res) {
    const stateId = req.query.state_id ? parseInt(req.query.state_id, 10) : null;
    const page    = req.query.page     ? parseInt(req.query.page,     10) : 1;
    const limit   = req.query.limit    ? parseInt(req.query.limit,    10) : 50;

    const result = await useCases.getTasksMobile(req.user.id, { stateId, page, limit });
    return respond.ok(res, result);
}

/**
 * GET /gtpp/tasks/:id
 * Retorna uma tarefa completa com itens e usuários.
 */
async function getTaskById(req, res) {
    const taskId = parseInt(req.params.id, 10);
    const task = await useCases.getTaskById(taskId);
    return respond.ok(res, task);
}

/**
 * POST /gtpp/tasks
 * Cria uma nova tarefa.
 * Sem evento WS: não há outros usuários vinculados no momento da criação.
 */
async function createTask(req, res) {
    const {
        title, description,
        priority,
        initial_date,
        final_date, expire_day,
        theme_id,
    } = req.body;

    let computedFinalDate = final_date ?? null;
    if (!computedFinalDate && expire_day) {
        const d = new Date();
        d.setDate(d.getDate() + parseInt(expire_day, 10));
        computedFinalDate = d.toISOString().split('T')[0];
    }

    const result = await useCases.createTask(req.user.id, {
        description:     title,                                    // título → description
        fullDescription: description ?? null,                      // descrição → full_description
        priority:        priority    ? parseInt(priority, 10) : null,
        initialDate:     initial_date ?? null,
        finalDate:       computedFinalDate,
        themeId:         theme_id    ? parseInt(theme_id, 10) : null,
    });
    return respond.created(res, result);
}

/**
 * PUT /gtpp/tasks/:id/state
 * Atualiza o estado de uma tarefa.
 * Body: { state_id, description? }
 * Evento WS tipo 6 — estado da tarefa alterado.
 */
async function updateTaskState(req, res) {
    const taskId  = parseInt(req.params.id, 10);
    const { state_id, description, days } = req.body;

    if (!state_id) throw new AppError('O campo state_id é obrigatório.', 400);

    const newStateId = parseInt(state_id, 10);

    // Estado 5 (Expirado) é exclusivo para administradores — autorização de
    // rota específica, não invariante de domínio, por isso fica no controller.
    if (newStateId === 5) {
        const perms   = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
        const isAdmin = perms.includes('GTPP_MANAGE') || perms.includes('SYSTEM_OWNER');
        if (!isAdmin) throw new AppError('Apenas administradores podem marcar uma tarefa como "Expirado".', 403);
    }

    await useCases.updateTaskState(taskId, newStateId, description, req.user, days);

    return respond.message(res, 'Estado atualizado com sucesso.');
}

/**
 * PUT /gtpp/tasks/:id/title
 * Atualiza o título de uma tarefa.
 * Body: { description }
 * Evento WS tipo 8 — atualização geral.
 */
async function updateTaskTitle(req, res) {
    const taskId = parseInt(req.params.id, 10);
    const title  = req.body.description ?? null;

    if (!title) throw new AppError('Campo obrigatório: description', 400);

    await useCases.updateTaskTitle(taskId, title, req.user);

    return respond.message(res, 'Título atualizado com sucesso.');
}

/**
 * PUT /gtpp/tasks/:id/description
 * Atualiza a descrição de uma tarefa.
 * Body: { full_description }
 * Evento WS tipo 3 — descrição atualizada.
 */
async function updateTaskDescription(req, res) {
    const taskId = parseInt(req.params.id, 10);

    // Aceita tanto `full_description` (correto) quanto `description` (legado)
    const fullDescription = req.body.full_description ?? req.body.description ?? null;

    await useCases.updateTaskDescription(taskId, fullDescription, req.user);

    return respond.message(res, 'Descrição atualizada com sucesso.');
}

/**
 * PUT /gtpp/tasks/:id/theme
 * Atualiza o tema de uma tarefa.
 * Body: { theme_id }
 * Evento WS tipo 8 — atualização geral.
 */
async function updateTaskTheme(req, res) {
    const taskId  = parseInt(req.params.id, 10);
    const themeId = req.body.theme_id ? parseInt(req.body.theme_id, 10) : null;

    await useCases.updateTaskTheme(taskId, themeId, req.user);

    return respond.message(res, 'Tema atualizado com sucesso.');
}

/**
 * DELETE /gtpp/tasks/:id
 * Remove uma tarefa permanentemente.
 * Evento WS tipo 8 — notifica usuários antes de deletar.
 */
async function deleteTask(req, res) {
    const taskId = parseInt(req.params.id, 10);

    await useCases.deleteTask(taskId, req.user);

    return respond.message(res, 'Tarefa excluída com sucesso.');
}

/**
 * GET /gtpp/tasks/board?state_ids=1,2,3&page=1&limit=20
 * Retorna tarefas de múltiplos estados em uma única requisição.
 * Cada chave do objeto `data` é o state_id.
 */
async function getTasksBoard(req, res) {
    const raw = typeof req.query.state_ids === 'string' ? req.query.state_ids : '';
    const stateIds = raw
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n) && n > 0);

    if (stateIds.length === 0) throw new AppError('Parâmetro state_ids é obrigatório (ex: state_ids=1,2,3).', 400);
    if (stateIds.length > 10) throw new AppError('Máximo de 10 estados por requisição.', 400);

    const page  = req.query.page  ? parseInt(req.query.page,  10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;

    const board = await useCases.getTasksBoard(req.user.id, { stateIds, page, limit });
    return respond.ok(res, board);
}

module.exports = {
    getTaskStates,
    getTaskHistoric,
    getTasks,
    getTasksBoard,
    getTaskById,
    createTask,
    updateTaskState,
    updateTaskTitle,
    updateTaskDescription,
    updateTaskTheme,
    deleteTask,
};
