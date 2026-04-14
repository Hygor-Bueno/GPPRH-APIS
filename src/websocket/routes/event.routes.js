const express = require("express");
const router = express.Router();

const { eventBus } = require("../eventBus");

router.post("/emit-event", (req, res) => {
  const { event, payload, options } = req.body;
  eventBus.emit(event, payload, options);
  res.json({ ok: true });
});

module.exports = router;