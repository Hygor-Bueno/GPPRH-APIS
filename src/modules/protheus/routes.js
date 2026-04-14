const express = require('express');
const router = express.Router();
const ProtheusController = require('./controllers/protheus.controller');
const authMiddleware = require('../../middlewares/auth.middleware');

router.get('/cost-centers/:code', authMiddleware, ProtheusController.listCostCenters);
router.get('/branches/:code', authMiddleware, ProtheusController.listBranches);
router.get('/companies', authMiddleware, ProtheusController.listCompanies);

module.exports = router;
