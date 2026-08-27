/**
 * @fileoverview Porta (contrato) de publicação de eventos GTPP em tempo real.
 *
 * Compartilhada por task, task-item, task-item-response, task-user e message.
 * Diferente do chat: aqui existe só UM adapter (`HttpGtppEventPublisher`),
 * porque a entrega sempre passa por HTTP internamente, não importa se quem
 * chamou está no processo REST ou no processo WebSocket.
 *
 * @module modules/global/application/gtpp/ports/gtpp-event-publisher.port
 */

class GtppEventPublisherPort {
    /**
     * @param {number} taskId
     * @param {number} senderId
     * @param {number} type
     * @param {object} object
     * @param {number[]} [includeUserIds] - Usuários a incluir além dos participantes atuais
     *   da tarefa (ex.: alguém que acabou de ser desvinculado, mas ainda precisa do evento).
     */
    broadcastEvent(taskId, senderId, type, object, includeUserIds = []) { throw new Error('Not implemented'); }
}

module.exports = { GtppEventPublisherPort };
