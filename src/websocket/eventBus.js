const { connectionManager } = require("./connectionManager");

const eventBus = {
  /**
   * Emite um evento para um ou mais usuários (ou broadcast).
   *
   * @param {string} event
   * @param {object} payload
   * @param {object} options
   * @param {number}   [options.toUserId]     - Envia para um único usuário
   * @param {number[]} [options.toUserIds]    - Envia para uma lista de usuários;
   *                                            retorna array dos IDs que receberam
   * @param {number}   [options.excludeUserId]- Broadcast excluindo este usuário
   * @returns {number[]|void} IDs que receberam quando toUserIds é usado
   */
  emit(event, payload, options = {}) {
    const { toUserId, toUserIds, excludeUserId } = options;

    const message = { event, payload };

    // 👉 envio para lista de usuários — retorna quem recebeu (estava online)
    if (Array.isArray(toUserIds)) {
      const delivered = [];
      for (const userId of toUserIds) {
        const sockets = connectionManager.users.get(userId);
        if (sockets && sockets.size > 0) {
          connectionManager.sendToUser(userId, message);
          delivered.push(userId);
        }
      }
      return delivered;
    }

    // 👉 envio direto para um usuário
    if (toUserId) {
      return connectionManager.sendToUser(toUserId, message);
    }

    // 👉 broadcast geral
    return connectionManager.broadcast(message, excludeUserId);
  }
};

module.exports = { eventBus };