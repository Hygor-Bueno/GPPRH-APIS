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

// Rota histórica: jornadas em aberto (1) e fechadas (2), como sempre foi.
// O recorte de status virou explícito na query em 08/2026 — ver sqlGetPaymentRegistered.
router.get('/time-records/payment',
    authMiddleware,
    canAny(['GIPP_VIEW_TIMERECORD', 'GIPP_MANAGE_TIMERECORD']),
    asyncHandler(gippController.getPaymentRegistered));

// ─── Filas de aprovação ───────────────────────────────────────────────────────
//
// Cada fila é uma rota própria, com permissão própria, em vez de um parâmetro
// de status: assim o que cada papel enxerga é decidido pela permissão da rota,
// e não por um valor que o cliente poderia trocar.

/** Fila do gerente — status 2, aguardando aprovação. */
router.get('/time-records/payment/pending-approval',
    authMiddleware,
    canAny(['GIPP_APPROVE_TIMERECORD', 'GIPP_MANAGE_TIMERECORD']),
    asyncHandler(gippController.getPendingApproval));

/** Fila do RH — status 3, aprovadas e aguardando finalização.
 *  Mesmas permissões de POST /payments: quem finaliza é quem precisa conferir. */
router.get('/time-records/payment/approved',
    authMiddleware,
    canAny(['GIPP_CREATE_PAYMENT', 'GIPP_MANAGE_PAYMENT']),
    asyncHandler(gippController.getApprovedPayments));

/** Fila do encarregado — status 1 e 2 que ele mesmo lançou.
 *  O id do lançador vem do token; `?launched_by=` só vale para quem tem
 *  permissão de gestão (ver CAN_VIEW_OTHER_LAUNCHERS no controller). */
router.get('/time-records/payment/mine',
    authMiddleware,
    canAny(['GIPP_VIEW_TIMERECORD', 'GIPP_MANAGE_TIMERECORD']),
    asyncHandler(gippController.getPaymentByLauncher));

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

// Desconsiderar jornada — ação separada com permissão própria.
// Vale para o encarregado limpar jornada aberta (1) e para o gerente reprovar (2).
// Jornada em 3, 4 ou 5 é recusada com 409 pelo caso de uso.
router.patch('/time-records/discard',
    authMiddleware,
    canAny(['GIPP_DISCARD_TIMERECORD', 'GIPP_MANAGE_TIMERECORD']),
    validate(discardTimeRecordSchema),
    asyncHandler(gippController.discardTimeRecord));

/** Aprovação do gerente — move jornadas de 2 para 3, em lote. */
router.patch('/time-records/approve',
    authMiddleware,
    canAny(['GIPP_APPROVE_TIMERECORD', 'GIPP_MANAGE_TIMERECORD']),
    asyncHandler(gippController.approveTimeRecords));

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