const { connectionManager } = require("./connectionManager");

const eventBus = {
  emit(event, payload, options = {}) {
    const { toUserId, excludeUserId } = options;

    const message = {
      event,
      payload,
    };

    // 👉 envio direto
    if (toUserId) {
      return connectionManager.sendToUser(toUserId, message);
    }

    // 👉 broadcast
    return connectionManager.broadcast(message, excludeUserId);
  }
};

module.exports = { eventBus };