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

const { eventBus }                          = require("./eventBus");
const { handleChatSend, handleChatTyping, handleChatNudge } = require("./events/chat.event");
const { handleGtppEvent }                   = require("./events/gtpp.event");

function parseUserAgent(ua = '') {
  let browser = 'Desconhecido';
  let os      = 'Desconhecido';

  if (/Edg\//i.test(ua))            browser = 'Edge';
  else if (/OPR\//i.test(ua))       browser = 'Opera';
  else if (/Chrome\//i.test(ua))    browser = 'Chrome';
  else if (/Firefox\//i.test(ua))   browser = 'Firefox';
  else if (/Safari\//i.test(ua))    browser = 'Safari';

  if (/Windows NT/i.test(ua))       os = 'Windows';
  else if (/Android/i.test(ua))     os = 'Android';
  else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
  else if (/Mac OS/i.test(ua))      os = 'macOS';
  else if (/Linux/i.test(ua))       os = 'Linux';

  return { browser, os };
}

async function authenticateWS(ws, req) {
  try {
    const cookies = cookie.parse(req.headers.cookie || "");
    const { user } = await authenticateFromCookies(cookies);

    const ip        = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const userAgent = req.headers['user-agent'] || '';
    const { browser, os } = parseUserAgent(userAgent);

    ws.user   = user;
    ws.userId = user.id;

    connectionManager.add(ws, ws.userId, {
      user_id:              user.id,
      name:                 user.name,
      registration:         user.registration,
      branch_code:          user.branch_code,
      branch_name:          user.branch_name,
      company_code:         user.company_code,
      company_name:         user.company_name,
      cost_center_code:     user.cost_center_code,
      cost_center_description: user.cost_center_description,
      ip,
      browser,
      os,
      user_agent:           userAgent,
    });

    console.log(`🔐 WS autenticado userId=${ws.userId} | IP=${ip} | ${browser}/${os}`);
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

  // 1. Envia para o novo usuário a lista completa de quem já está online
  connectionManager.sendToUser(ws.userId, {
    event:   'presence:online-list',
    payload: { onlineUsers: connectionManager.getOnlineUsers() }
  });

  // 2. Avisa todos os outros que este usuário entrou
  connectionManager.broadcast(
    {
      event:   'presence:online',
      payload: {
        userId: ws.userId,
        name:   ws.user?.nickname ?? ws.user?.name ?? null,
      }
    },
    ws.userId // exclui o próprio usuário
  );

  ws.on("message", async (raw) => {
    try {
      const { event, payload } = JSON.parse(raw);

      // ── Chat: enviar mensagem ──────────────────────────────────────────────
      if (event === "chat:send") {
        await handleChatSend(ws, payload);
        return;
      }

      // ── Chat: indicador de digitação ──────────────────────────────────────
      if (event === "chat:typing") {
        handleChatTyping(ws, payload);
        return;
      }

      // ── Chat: nudge ───────────────────────────────────────────────────
      if (event === "chat:nudge") {
        handleChatNudge(ws, payload);
        return;
      }

      // ── Presença: away / online ───────────────────────────────────────
      if (event === "status:away" || event === "status:online") {
        connectionManager.broadcast(
          { event, payload: { user_id: ws.userId } },
          ws.userId
        );
        return;
      }

      // ── GTPP: evento de tarefa (distribui para colaboradores) ────────────
      if (event === "gtpp:event") {
        await handleGtppEvent(ws, payload);
        return;
      }

      // ── Mensagem privada legada (mantida para compatibilidade) ─────────────
      if (event === "send-private-message") {
        const { toUserId, text } = payload;
        connectionManager.sendToUser(toUserId, {
          event: "private-message",
          payload: { text, from: ws.userId },
        });
        return;
      }

    } catch (err) {
      console.error("Erro WS:", err.message);
    }
  });

  ws.on("close", () => {
    console.log(`🔴 WS fechado userId=${ws.userId}`);
    const userId = ws.userId;
    connectionManager.remove(ws);

    // Avisa todos que este usuário saiu (só se não tiver outra aba aberta)
    if (!connectionManager.getOnlineUsers().includes(userId)) {
      connectionManager.broadcast({
        event:   'presence:offline',
        payload: {
          userId,
          name: ws.user?.nickname ?? ws.user?.name ?? null,
        }
      });
    }
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