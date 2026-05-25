const express = require('express');
const router = express.Router();
const authMiddleware = require('../../middlewares/auth.middleware');
const { canAny, canAll } = require('../../middlewares/permission.middleware');
const { asyncHandler } = require('../../middlewares/async-handler.middleware');
const gippController = require('./controllers/gipp.controller');

// ─── Status ───────────────────────────────────────────────────────────────────
router.get('/status',
    authMiddleware,
    canAll(['VIEW_EMPLOYEES']),
    asyncHandler(gippController.getStatus));

// ─── Registros de Ponto ───────────────────────────────────────────────────────

router.get('/time-records/payment',
    authMiddleware,
    canAny(['VIEW_TIME_RECORDS', 'MANAGE_TIME_RECORDS']),
    asyncHandler(gippController.getPaymentRegistered));

router.get('/time-records/record-types',
    authMiddleware,
    canAll(['VIEW_EMPLOYEES']),
    asyncHandler(gippController.getRecordTypes));

// GET /gipp/time-records?codWorkSchedule=X  → detalhe da jornada
// GET /gipp/time-records?pageNumber=1&pageSize=50&name=...  → lista paginada
router.get('/time-records',
    authMiddleware,
    canAny(['VIEW_TIME_RECORDS', 'MANAGE_TIME_RECORDS']),
    asyncHandler(gippController.getTimeRecords));

router.post('/time-records',
    authMiddleware,
    canAny(['CREATE_TIME_RECORDS', 'MANAGE_TIME_RECORDS']),
    asyncHandler(gippController.postTimeRecord));

router.put('/time-records',
    authMiddleware,
    canAny(['EDIT_TIME_RECORDS', 'MANAGE_TIME_RECORDS']),
    asyncHandler(gippController.putTimeRecord));

// ─── Pagamentos ───────────────────────────────────────────────────────────────
router.post('/payments',
    authMiddleware,
    canAny(['CREATE_PAYMENTS', 'MANAGE_PAYMENTS']),
    asyncHandler(gippController.postPayments));

router.post('/payments/close',
    authMiddleware,
    canAny(['CREATE_PAYMENTS', 'MANAGE_PAYMENTS']),
    asyncHandler(gippController.postPaymentsClose));

module.exports = router;