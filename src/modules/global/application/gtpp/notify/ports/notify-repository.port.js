/**
 * @fileoverview Porta (contrato) de persistência MySQL para notificações GTPP.
 *
 * `insertNotification` é consumida tanto pelo caso de uso de Notify quanto,
 * futuramente (Fase 4), pelo `HttpGtppEventPublisher` — mas cada um recebe
 * sua PRÓPRIA instância de `NotifyRepositoryPort` (não um port compartilhado
 * entre suites), já que aqui o compartilhamento é só dentro do GTPP.
 *
 * @module modules/global/application/gtpp/notify/ports/notify-repository.port
 */

class NotifyRepositoryPort {
    /** @param {number} userId @returns {Promise<object[]>} */
    getAndConsume(userId) { throw new Error('Not implemented'); }

    /**
     * @param {number} toUserId
     * @param {number} fromUserId
     * @param {number} taskId
     * @param {number} type
     * @param {string} objectJson - JSON já serializado (`JSON.stringify`).
     */
    insertNotification(toUserId, fromUserId, taskId, type, objectJson) { throw new Error('Not implemented'); }
}

module.exports = { NotifyRepositoryPort };
