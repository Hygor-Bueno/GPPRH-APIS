const express = require('express');
const router = express.Router();
const ProtheusController = require('./controllers/protheusController');

router.get('/cost-centers', ProtheusController.listCostCenters);
router.get('/branches', ProtheusController.listBranches);
router.get('/branches/:code', ProtheusController.getBranch);

module.exports = router;
