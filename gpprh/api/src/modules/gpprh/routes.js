const express = require("express");
const router = express.Router();

const adController = require("./controllers/adController");

router.post("/ad-login", adController.login);

module.exports = router;
