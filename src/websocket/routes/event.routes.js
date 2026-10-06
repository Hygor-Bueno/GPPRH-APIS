const express = require("express");
const router = express.Router();

const { eventBus }           = require("../eventBus");
const { connectionManager }  = require("../connectionManager");
const authMiddleware         = require("../../middlewares/auth.middleware");
const { canAny }             = require("../../middlewares/permission.middleware");

router.post("/emit-event", (req, res) => {
  const { event, payload, options } = req.body;
  const delivered = eventBus.emit(event, payload, options);
  res.json({ ok: true, delivered: delivered ?? [] });
});

function sendOnlineUsers(req, res) {
  res.json({ ok: true, users: connectionManager.getOnlineUsersData() });
}

// Dois jeitos de entrar:
//   - `x-api-key` = WS_API_KEY → chamadas servidor-a-servidor (a chave nunca
//     pode ir para o bundle do front, onde qualquer um a lê);
//   - sessão por cookie com ACCESS_VIEW/ACCESS_MANAGE → o painel no navegador.
//     A lista traz IP e user-agent de todos os conectados, por isso fica com
//     quem já administra acessos.
router.get(
  "/online-users",
  (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (process.env.WS_API_KEY && apiKey === process.env.WS_API_KEY) {
      return sendOnlineUsers(req, res);
    }
    next();
  },
  authMiddleware,
  canAny(['ACCESS_VIEW', 'ACCESS_MANAGE']),
  sendOnlineUsers
);

module.exports = router;