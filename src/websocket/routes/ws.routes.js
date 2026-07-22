const express = require('express');
const router  = express.Router();

const { connectionManager } = require('../connectionManager');

router.get('/online-users', (req, res) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;

    if (process.env.WS_API_KEY && apiKey !== process.env.WS_API_KEY) {
        return res.status(401).json({ error: true, message: 'Unauthorized' });
    }

    res.json({ error: false, data: connectionManager.getOnlineUsersData() });
});

module.exports = router;
