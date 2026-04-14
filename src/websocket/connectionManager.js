// connectionManager.js
class ConnectionManager {
  constructor() {
    // Map: userId -> Set of WebSocket connections
    this.users = new Map();
  }

  /**
   * Adiciona uma conexão WS para um usuário
   */
  add(ws, userId) {
    ws.userId = userId; // associa o WS ao usuário

    if (!this.users.has(userId)) {
      this.users.set(userId, new Set());
    }

    this.users.get(userId).add(ws);
    console.log(`✅ WS adicionado para userId=${userId}. Total conexões: ${this.users.get(userId).size}`);
  }

  /**
   * Remove uma conexão WS
   */
  remove(ws) {
    const { userId } = ws;
    if (!userId) return;

    const set = this.users.get(userId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        this.users.delete(userId);
      }
      console.log(`❌ WS removido para userId=${userId}. Conexões restantes: ${set.size}`);
    }
  }

  /**
   * Broadcast para todos os usuários
   */
  broadcast(data, excludeUserId = null) {
    const message = JSON.stringify(data);
    for (const [userId, sockets] of this.users.entries()) {
      for (const ws of sockets) {
        if (excludeUserId && userId === excludeUserId) continue; // pula o usuário excluído
        if (ws.readyState === ws.OPEN) {
          ws.send(message);
        }
      }
    }
  }

  /**
   * Envia mensagem para um usuário específico
   */
  sendToUser(userId, data) {
    const sockets = this.users.get(userId);
    if (!sockets) return;

    const message = JSON.stringify(data);
    for (const ws of sockets) {
      if (ws.readyState === ws.OPEN) {
        ws.send(message);
      }
    }
  }

  /**
   * Retorna lista de usuários online
   */
  getOnlineUsers() {
    return Array.from(this.users.keys());
  }
}

// Exporta singleton
module.exports.connectionManager = new ConnectionManager();