const express = require('express');
const router = express.Router();
const ProtheusController = require('./controllers/protheus.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const { asyncHandler } = require('../../middlewares/async-handler.middleware');

router.get('/cost-centers/:code', authMiddleware, asyncHandler(ProtheusController.listCostCenters));
router.get('/branches/:code', authMiddleware, asyncHandler(ProtheusController.listBranches));
router.get('/companies', authMiddleware, asyncHandler(ProtheusController.listCompanies));

module.exports = router;
