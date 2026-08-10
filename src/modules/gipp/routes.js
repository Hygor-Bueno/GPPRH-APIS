const express = require('express');
const router = express.Router();
const authMiddleware = require('../../middlewares/auth.middleware');
const { canAny, canAll } = require('../../middlewares/permission.middleware');
const { asyncHandler } = require('../../middlewares/async-handler.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const {
    postTimeRecordSchema,
    putTimeRecordSchema,
    discardTimeRecordSchema,
} = require('../../schemas/gipp.schema');
const gippController = require('./controllers/gipp.controller');

// ─── Status ───────────────────────────────────────────────────────────────────
router.get('/status',
    authMiddleware,
    canAll(['GIPP_VIEW_TIMERECORD']),
    asyncHandler(gippController.getStatus));

// ─── Registros de Ponto ───────────────────────────────────────────────────────

router.get('/time-records/payment',
    authMiddleware,
    canAny(['GIPP_VIEW_TIMERECORD', 'GIPP_MANAGE_TIMERECORD']),
    asyncHandler(gippController.getPaymentRegistered));

router.get('/time-records/record-types',
    authMiddleware,
    canAll(['GIPP_VIEW_TIMERECORD']),
    asyncHandler(gippController.getRecordTypes));

router.get('/time-records',
    authMiddleware,
    canAny(['GIPP_VIEW_TIMERECORD', 'GIPP_MANAGE_TIMERECORD']),
    asyncHandler(gippController.getTimeRecords));

router.post('/time-records',
    authMiddleware,
    canAny(['GIPP_CREATE_TIMERECORD', 'GIPP_MANAGE_TIMERECORD']),
    validate(postTimeRecordSchema),
    asyncHandler(gippController.postTimeRecord));

router.put('/time-records',
    authMiddleware,
    canAny(['GIPP_UPDATE_TIMERECORD', 'GIPP_MANAGE_TIMERECORD']),
    validate(putTimeRecordSchema),
    asyncHandler(gippController.putTimeRecord));

// Desconsiderar jornada — ação separada com permissão própria
router.patch('/time-records/discard',
    authMiddleware,
    canAny(['GIPP_DISCARD_TIMERECORD', 'GIPP_MANAGE_TIMERECORD']),
    validate(discardTimeRecordSchema),
    asyncHandler(gippController.discardTimeRecord));

// ─── Pagamentos ───────────────────────────────────────────────────────────────
router.post('/payments',
    authMiddleware,
    canAny(['GIPP_CREATE_PAYMENT', 'GIPP_MANAGE_PAYMENT']),
    asyncHandler(gippController.postPayments));

router.post('/payments/close',
    authMiddleware,
    canAny(['GIPP_CREATE_PAYMENT', 'GIPP_MANAGE_PAYMENT']),
    asyncHandler(gippController.postPaymentsClose));

module.exports = router;