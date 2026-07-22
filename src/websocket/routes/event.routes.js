const express = require("express");
const router = express.Router();

const { eventBus }           = require("../eventBus");
const { connectionManager }  = require("../connectionManager");

router.post("/emit-event", (req, res) => {
  const { event, payload, options } = req.body;
  const delivered = eventBus.emit(event, payload, options);
  res.json({ ok: true, delivered: delivered ?? [] });
});

router.get("/online-users", (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  if (process.env.WS_API_KEY && apiKey !== process.env.WS_API_KEY) {
    return res.status(401).json({ error: true, message: 'Unauthorized' });
  }
  res.json({ ok: true, users: connectionManager.getOnlineUsersData() });
});

module.exports = router;