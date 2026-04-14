require("dotenv").config();
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cookie = require("cookie");
const eventRoutes = require("./routes/event.routes");

const { connectionManager } = require("./connectionManager");
const { authenticateFromCookies } = require("../application/auth/auth-session.service.js");

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

/**
 * 🔥 HEARTBEAT
 */
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log(`💀 Conexão morta userId=${ws.userId}`);
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

/**
 * 🔐 AUTENTICAÇÃO
 */
const { eventBus } = require("./eventBus"); // importa

async function authenticateWS(ws, req) {
  try {
    const cookies = cookie.parse(req.headers.cookie || "");

    const { user } = await authenticateFromCookies(cookies);

    ws.user = user;
    ws.userId = user.id;

    connectionManager.add(ws, ws.userId);

    console.log(`🔐 WS autenticado userId=${ws.userId}`);

    return true;

  } catch (err) {
    console.log("❌ WS não autenticado:", err.message);
    ws.close(1008, "Unauthorized");
    return false;
  }
}

/**
 * Conexões WebSocket
 */
wss.on("connection", async (ws, req) => {
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  const isAuthenticated = await authenticateWS(ws, req);
  if (!isAuthenticated) return;

  ws.on("message", (raw) => {
    try {
      const { event, payload } = JSON.parse(raw);

      /**
       * 💬 mensagem privada
       */
      if (event === "send-private-message") {
        const { toUserId, text } = payload;

        connectionManager.sendToUser(toUserId, {
          event: "private-message",
          payload: {
            text,
            from: ws.userId,
          },
        });
      }

    } catch (err) {
      console.error("Erro WS:", err.message);
    }
  });

  ws.on("close", () => {
    console.log(`🔴 WS fechado userId=${ws.userId}`);
    connectionManager.remove(ws);
  });
});

/**
 * 🔥 cleanup
 */
wss.on("close", () => {
  clearInterval(interval);
});

/**
 * Inicialização do servidor
 */
const PORT = 4001;
server.listen(PORT, () => {
  console.log(`🚀 WebSocket server rodando na porta ${PORT}`);
});

// Rota para acesso via API Interna;
app.use("/ws", eventRoutes);