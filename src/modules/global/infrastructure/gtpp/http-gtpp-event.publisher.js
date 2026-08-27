/**
 * @fileoverview Adapter — implementa `GtppEventPublisherPort` via HTTP.
 *
 * Reaproveita `MysqlTaskUserRepository.findAllParticipantIds` e
 * `MysqlNotifyRepository.insertNotification` (ambos já migrados) em vez de
 * duplicar SQL como o código legado (`src/websocket/events/gtpp.event.js`)
 * fazia. Sempre entrega via `POST /ws/emit-event`, não importa se quem
 * chamou está no processo REST ou no processo WebSocket — por isso só existe
 * este adapter, sem um par "local" como o chat tem.
 *
 * @module modules/global/infrastructure/gtpp/http-gtpp-event.publisher
 */

const axios = require('axios');
const { GtppEventPublisherPort } = require('../../application/gtpp/ports/gtpp-event-publisher.port');
const { MysqlTaskUserRepository } = require('./mysql-task-user.repository');
const { MysqlNotifyRepository } = require('./mysql-notify.repository');

/**
 * Endereço interno do servidor WS. Default assume mesmo host (PM2, onde API e
 * WS são processos separados mas compartilham "localhost"). Em deploy com
 * containers separados (API e WS em containers distintos), `localhost` do
 * container da API não alcança o container do WS — precisa apontar pro nome
 * do container na rede Docker (ex.: `http://ws-interno:4001/ws/emit-event`),
 * via variável de ambiente `WS_EMIT_URL`.
 */
const WS_EMIT_URL = process.env.WS_EMIT_URL || 'http://localhost:4001/ws/emit-event';

class HttpGtppEventPublisher extends GtppEventPublisherPort {
    constructor({ taskUserRepository = new MysqlTaskUserRepository(), notifyRepository = new MysqlNotifyRepository() } = {}) {
        super();
        this.taskUserRepository = taskUserRepository;
        this.notifyRepository = notifyRepository;
    }

    async broadcastEvent(taskId, senderId, type, object, includeUserIds = []) {
        // 1. Busca todos os participantes da tarefa (+ includeUserIds explícitos,
        //    ex.: alguém recém-desvinculado que ainda precisa do evento).
        let taskUserIds;
        try {
            const base = await this.taskUserRepository.findAllParticipantIds(taskId);
            taskUserIds = [...new Set([...base, ...includeUserIds])];
        } catch (err) {
            console.error('[gtpp:broadcast] Failed to fetch task users:', err.message);
            return;
        }

        if (taskUserIds.length === 0) {
            console.warn(`[gtpp:broadcast] No users found for task_id=${taskId}`);
            return;
        }

        // 2. Envia via HTTP para o processo do servidor WS (connectionManager vive lá).
        //    A rota /ws/emit-event retorna { ok, delivered: [userId, ...] } — IDs que estavam online.
        let delivered = [];
        try {
            const { data } = await axios.post(
                WS_EMIT_URL,
                {
                    event: 'gtpp:event',
                    payload: { send_user_id: senderId, task_id: taskId, type, object },
                    options: { toUserIds: taskUserIds },
                },
                { timeout: 3000 }
            );
            delivered = Array.isArray(data?.delivered) ? data.delivered : [];
        } catch (err) {
            console.error('[gtpp:broadcast] Failed to call WS emit-event:', err.message);
            // Mesmo em caso de falha no WS, persiste notificações offline abaixo.
        }

        // 3. Usuários offline → gt_notify, pra consumir no próximo polling.
        //    Falha ao gravar notificação nunca deve derrubar o broadcast inteiro.
        const deliveredSet = new Set(delivered);
        const objectJson = JSON.stringify(object);

        for (const userId of taskUserIds) {
            if (deliveredSet.has(userId)) continue;
            try {
                await this.notifyRepository.insertNotification(userId, senderId, taskId, type, objectJson);
            } catch (err) {
                console.error(`[gtpp:broadcast] Failed to insert notify for userId=${userId}:`, err.message);
            }
        }

        console.log(
            `[gtpp:broadcast] type=${type} task_id=${taskId} sender=${senderId}` +
            ` → ${delivered.length} online, ${taskUserIds.length - delivered.length} notified offline`
        );
    }
}

module.exports = { HttpGtppEventPublisher, WS_EMIT_URL };
