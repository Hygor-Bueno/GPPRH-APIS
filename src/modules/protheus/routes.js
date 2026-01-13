const express = require('express');
const router = express.Router();
const ProtheusController = require('./controllers/protheusController');
const authMiddleware = require('../../middlewares/authMiddleware');

router.get('/cost-centers/:code', authMiddleware,  ProtheusController.listCostCenters);
router.get('/branches/:code', authMiddleware, ProtheusController.listBranches);
router.get('/companies', authMiddleware, ProtheusController.listCompanies);

module.exports = router;
