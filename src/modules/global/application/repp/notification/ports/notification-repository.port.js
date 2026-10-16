/**
 * @fileoverview Porta de leitura e confirmação de `re_notifications`.
 *
 * A GRAVAÇÃO não passa por aqui: o aviso nasce dentro da transação da ação
 * (`BookingRepositoryPort.runLocked` → `tx.insertNotification`).
 *
 * @module modules/global/application/repp/notification/ports/notification-repository.port
 */

class NotificationRepositoryPort {
    /**
     * Não lidas do usuário, mais recentes primeiro. Buscar NÃO marca como
     * lida nem apaga.
     * @param {number} userId
     * @param {number} limit
     * @returns {Promise<object[]>}
     */
    listUnread(userId, limit) { throw new Error('Not implemented'); }

    /**
     * Marca como lidas. Idempotente: id já lido ou de outro usuário é
     * ignorado, sem erro.
     * @param {number[]} ids
     * @param {number} userId
     * @returns {Promise<number>} quantas mudaram agora.
     */
    markRead(ids, userId) { throw new Error('Not implemented'); }

    /**
     * Apaga as lidas há mais de `days` dias (de todos os usuários), em lote.
     * @param {number} days
     * @param {number} batchSize
     * @returns {Promise<number>} quantas foram apagadas.
     */
    purgeRead(days, batchSize) { throw new Error('Not implemented'); }
}

module.exports = { NotificationRepositoryPort };
