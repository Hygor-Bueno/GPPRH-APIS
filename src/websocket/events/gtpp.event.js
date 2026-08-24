/**
 * @fileoverview Handler de eventos WebSocket do GTPP.
 *
 * Porta do `MessageComponent.php` do servidor PHP.
 *
 * A distribuição de evento em si (buscar participantes, entregar via WS,
 * persistir notificação offline) foi migrada para Clean/Hexagonal e agora
 * mora em `src/modules/global/infrastructure/gtpp/http-gtpp-event.publisher.js`
 * (`HttpGtppEventPublisher`) — este arquivo só delega. `broadcastGtppEvent`
 * não é mais exportado: todos os controllers GTPP já migraram para injetar
 * `GtppEventPublisherPort` diretamente em seus use-cases; o único consumidor
 * restante é `handleGtppEvent`, chamado por `websocketServer.js`.
 *
 * Fluxo:
 *   1. Frontend envia `{ event: "gtpp:event", payload: { type, task_id, object } }`
 *   2. Servidor busca TODOS os usuários da tarefa (criador + vinculados)
 *   3. Usuários ONLINE  → recebem o evento via WS em tempo real
 *   4. Usuários OFFLINE → recebem uma notificação persistida em `gt_notify`
 *      para consumir no próximo `GET /gtpp/notifications`
 *
 * Tipos de evento (usados pelo frontend):
 *  1  — mensagem de chat da tarefa
 *  2  — item alterado (check, criação, remoção)
 *  3  — descrição da tarefa atualizada
 *  5  — usuário vinculado/desvinculado
 *  6  — estado da tarefa alterado
 *  7  — novo comentário/evidência
 *  8  — atualização geral
 *  9  — comentário/mensagem deletado
 *  10 — comentário/mensagem atualizado
 * -3  — mensagem privada direta (type reservado do sistema)
 *
 * @module websocket/events/gtpp.event
 */

'use strict';

const { HttpGtppEventPublisher } = require('../../modules/global/infrastructure/gtpp/http-gtpp-event.publisher');

const publisher = new HttpGtppEventPublisher();

/**
 * Distribui um evento GTPP para todos os usuários de uma tarefa.
 * Único consumidor: `handleGtppEvent` (evento originado via WebSocket).
 *
 * @param {number} taskId    - ID da tarefa
 * @param {number} senderId  - ID do usuário que originou a ação
 * @param {number} type      - Tipo do evento
 * @param {object} object    - Payload do evento
 * @param {number[]} [includeUserIds]
 */
async function broadcastGtppEvent(taskId, senderId, type, object, includeUserIds = []) {
    return publisher.broadcastEvent(taskId, senderId, type, object, includeUserIds);
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

module.exports = { handleGtppEvent };
