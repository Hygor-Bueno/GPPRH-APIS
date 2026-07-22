/**
 * @fileoverview Handler de eventos WebSocket do GTPP.
 *
 * Porta do `MessageComponent.php` do servidor PHP.
 *
 * Fluxo:
 *   1. Frontend envia `{ event: "gtpp:event", payload: { type, task_id, object } }`
 *   2. Servidor busca TODOS os usuários da tarefa (criador + vinculados)
 *   3. Usuários ONLINE  → recebem o evento via WS em tempo real
 *   4. Usuários OFFLINE → recebem uma notificação persistida em `gt_notify`
 *      para consumir no próximo `GET /gtpp/notifications`
 *
 * Formato enviado ao cliente (padrão do servidor Node.js):
 * ```json
 * {
 *   "event": "gtpp:event",
 *   "payload": {
 *     "send_user_id": <remetente>,
 *     "task_id":      <id da tarefa>,
 *     "type":         <tipo do evento>,
 *     "object":       { ...payload... }
 *   }
 * }
 * ```
 *
 * Tipos de evento (usados pelo frontend):
 *  2  — item alterado (check, criação, remoção)
 *  3  — descrição da tarefa atualizada
 *  5  — usuário vinculado/desvinculado
 *  6  — estado da tarefa alterado
 *  7  — novo comentário/evidência
 *  8  — atualização geral
 *  9  — comentário deletado
 * -3  — mensagem privada direta (type reservado do sistema)
 *
 * @module websocket/events/gtpp.event
 */

'use strict';

const axios              = require('axios');
const { poolGlobal }     = require('../../config/mysql');

// Endereço interno do servidor WS (mesma máquina, porta 4001)
const WS_EMIT_URL = 'http://localhost:4001/ws/emit-event';

// ─── Query: todos os usuários da tarefa (criador + vinculados) ─────────────
const SQL_GET_TASK_USERS_ALL = `
  SELECT user_id FROM gt_task_user WHERE task_id = ?
  UNION
  SELECT user_id FROM gt_task WHERE id = ?
`;

// ─── Query: inserir notificação para usuário offline ──────────────────────
const SQL_INSERT_NOTIFY = `
  INSERT INTO gt_notify (user_id, send_user_id, task_id, type, object)
  VALUES (?, ?, ?, ?, ?)
`;

/**
 * Distribui um evento GTPP para todos os usuários de uma tarefa.
 *
 * Utilizado tanto pelo handler WS (`handleGtppEvent`) quanto pelos
 * controllers HTTP após mutações (criar item, mudar estado, etc.),
 * garantindo que todos os participantes sejam notificados independente
 * de como a ação foi originada.
 *
 * Usuários ONLINE  → evento WS em tempo real
 * Usuários OFFLINE → notificação persistida em `gt_notify`
 *
 * @param {number} taskId    - ID da tarefa
 * @param {number} senderId  - ID do usuário que originou a ação
 * @param {number} type      - Tipo do evento (2, 3, 5, 6, 7, 8, 9…)
 * @param {object} object    - Payload do evento
 */
async function broadcastGtppEvent(taskId, senderId, type, object, includeUserIds = []) {
    // 1. Busca todos os participantes da tarefa
    //    includeUserIds permite adicionar usuários que já foram desvinculados mas
    //    ainda precisam receber o evento (ex: type 5 action=removed)
    let taskUserIds;
    try {
        const [rows] = await poolGlobal.execute(SQL_GET_TASK_USERS_ALL, [taskId, taskId]);
        const base = rows.map(r => r.user_id);
        taskUserIds = [...new Set([...base, ...includeUserIds])];
    } catch (err) {
        console.error('[gtpp:broadcast] Failed to fetch task users:', err.message);
        return;
    }

    if (taskUserIds.length === 0) {
        console.warn(`[gtpp:broadcast] No users found for task_id=${taskId}`);
        return;
    }

    // 2. Envia via HTTP para o processo do servidor WS (connectionManager vive lá)
    //    A rota /ws/emit-event retorna { ok, delivered: [userId, ...] } — IDs que estavam online
    let delivered = [];
    try {
        const { data } = await axios.post(
            WS_EMIT_URL,
            {
                event:   'gtpp:event',
                payload: {
                    send_user_id: senderId,
                    task_id:      taskId,
                    type,
                    object,
                },
                options: { toUserIds: taskUserIds },
            },
            { timeout: 3000 }
        );
        delivered = Array.isArray(data?.delivered) ? data.delivered : [];
    } catch (err) {
        console.error('[gtpp:broadcast] Failed to call WS emit-event:', err.message);
        // Mesmo em caso de falha no WS, persiste notificações offline abaixo
    }

    // 3. Usuários offline → gt_notify para consumir no próximo polling
    const deliveredSet = new Set(delivered);
    const objectJson   = JSON.stringify(object);

    for (const userId of taskUserIds) {
        if (deliveredSet.has(userId)) continue;
        try {
            await poolGlobal.execute(SQL_INSERT_NOTIFY, [userId, senderId, taskId, type, objectJson]);
        } catch (err) {
            console.error(`[gtpp:broadcast] Failed to insert notify for userId=${userId}:`, err.message);
        }
    }

    console.log(
        `[gtpp:broadcast] type=${type} task_id=${taskId} sender=${senderId}` +
        ` → ${delivered.length} online, ${taskUserIds.length - delivered.length} notified offline`
    );
}

/**
 * Processa um evento GTPP recebido via WebSocket.
 *
 * @param {import('ws')} ws - Conexão WebSocket do remetente (já autenticado).
 * @param {{ type: number, task_id: number, object: object }} payload
 */
async function handleGtppEvent(ws, payload) {
    const { type, task_id, object } = payload ?? {};

    if (type === undefined || !task_id || !object) {
        ws.send(JSON.stringify({
            error: true,
            message: 'Payload inválido: type, task_id e object são obrigatórios.'
        }));
        return;
    }

    await broadcastGtppEvent(task_id, ws.userId, type, object);
}

module.exports = { handleGtppEvent, broadcastGtppEvent };
