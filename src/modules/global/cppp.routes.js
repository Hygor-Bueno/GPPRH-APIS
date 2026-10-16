/**
 * @fileoverview Roteador da suite CPPP — Controle de Ponto Peg Pese (relógio
 * Control iD REP-C, AFD da Portaria 671/2021).
 *
 * Montado pelo `routes.js` do global sob `/cppp`. Toda rota exige sessão
 * (`authMiddleware`) e permissão `CPPP_*` (`canAny`).
 *
 * Os seis movimentos da tela, sem sair dela:
 *
 * | Movimento                          | Rota                                        |
 * |------------------------------------|---------------------------------------------|
 * | 1. listar inconsistências          | `GET  /cppp/inconsistencies`                |
 * | 2. abrir o detalhe de um dia       | `GET  /cppp/days/:cpf/:date`                |
 * | 3. lançar o ajuste ali mesmo       | `POST /cppp/adjustments`                    |
 * | 4. ver a ocorrência sair da lista  | resposta do 3 traz o dia recalculado        |
 * | 5. disparar coleta e acompanhar    | `POST /cppp/collect-runs` → `GET .../:id`   |
 * | 6. histórico e estado da última    | `GET  /cppp/collect-runs`, `GET /cppp/devices` |
 * | cadastro de relógios (IP de cada um) | `POST/PUT /cppp/devices`, `.../test-connection` |
 *
 * ─── Restrição inegociável ───────────────────────────────────────────────────
 * Não existe rota de escrita contra o relógio, nem rota que altere
 * `cppp_afd_records`. Correção de marcação é `POST /cppp/adjustments`, sempre
 * ao lado da marcação original intacta. Se uma demanda parecer exigir uma
 * dessas duas coisas, o desenho está errado — ver `docs/cppp.md`.
 *
 * @module modules/global/cppp.routes
 */

const express = require('express');

const router = express.Router();

const collectController = require('./controllers/cppp-collect.controller');
const inconsistencyController = require('./controllers/cppp-inconsistency.controller');
const adjustmentController = require('./controllers/cppp-adjustment.controller');

const authMiddleware = require('../../middlewares/auth.middleware');
const { asyncHandler } = require('../../middlewares/async-handler.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const { canAny } = require('../../middlewares/permission.middleware');
const { CAN_READ, CAN_ADJUST, CAN_COLLECT } = require('./domain/cppp/cppp-access.rules');
const { upload: fileUpload } = require('../../utils/file/file.service');
const {
    postCollectRunSchema, postDeviceSchema, putDeviceSchema, testConnectionSchema,
    postAdjustmentSchema, cancelAdjustmentSchema,
} = require('../../schemas/cppp.schema');

// ─── Tratamento ──────────────────────────────────────────────────────────────

/**
 * @route GET /cppp/inconsistencies
 * @description Ocorrências do período, recalculadas a cada consulta (AFD +
 * ajustes). `status`: `pendente` (padrão), `tratada` ou `todas`. Nunca inclui
 * o dia corrente nem dia depois da última coleta bem-sucedida — o corte vem
 * em `window.cutoff`.
 * @access CPPP_USE
 */
router.get('/inconsistencies',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(inconsistencyController.list));

/**
 * @route GET /cppp/days/:cpf/:date
 * @description Tudo de um dia de uma pessoa: as batidas do relógio em ordem de
 * NSR, a visão tratada, as ocorrências com o contexto que as justifica
 * (mediana do `fecha_cedo`) e os ajustes já lançados.
 * @access CPPP_USE
 */
router.get('/days/:cpf/:date',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(inconsistencyController.day));

/**
 * @route GET /cppp/punches?view=afd|tratada
 * @description As duas visões, separadas: `afd` é a fiscal (só o relógio);
 * `tratada` é a que folha e relatórios consomem (AFD + ajustes).
 * @access CPPP_USE
 */
router.get('/punches',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(inconsistencyController.punches));

/** @access CPPP_USE */
router.get('/employees',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(inconsistencyController.employees));

// ─── Ajustes ─────────────────────────────────────────────────────────────────

/** @access CPPP_USE */
router.get('/adjustments',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(adjustmentController.list));

/**
 * @route POST /cppp/adjustments
 * @description Lança o ajuste — vale na hora, autoria de `req.user`. Aceita
 * JSON ou multipart (anexo no campo `file`, PDF ou imagem).
 * @access CPPP_ADJUST
 */
router.post('/adjustments',
    authMiddleware, canAny(CAN_ADJUST),
    fileUpload.single('file'),
    validate(postAdjustmentSchema),
    asyncHandler(adjustmentController.create));

/**
 * @route PATCH /cppp/adjustments/:id/cancel
 * @description Desfaz um ajuste lançado por engano. Nada é apagado.
 * @access CPPP_ADJUST
 */
router.patch('/adjustments/:id/cancel',
    authMiddleware, canAny(CAN_ADJUST),
    validate(cancelAdjustmentSchema),
    asyncHandler(adjustmentController.cancel));

/**
 * @route GET /cppp/adjustments/:id/attachment
 * @description Atestado é dado de saúde (LGPD art. 11): só quem trata ajuste
 * abre. A rota genérica `/files/:id` recusa arquivos do CPPP.
 * @access CPPP_ADJUST
 */
router.get('/adjustments/:id/attachment',
    authMiddleware, canAny(CAN_ADJUST),
    asyncHandler(adjustmentController.attachment));

// ─── Coleta ──────────────────────────────────────────────────────────────────

/** @access CPPP_USE */
router.get('/devices',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(collectController.listDevices));

/** @access CPPP_USE */
router.get('/devices/:id',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(collectController.getDevice));

/**
 * @route POST /cppp/devices
 * @description Cadastra um relógio: código, nome e IP (cada relógio tem o seu).
 * Login e senha são os mesmos para todos e ficam no `.env`. O IP precisa ser
 * literal e estar em `CPPP_DEVICE_ALLOWED_NETWORKS` — o servidor manda a
 * senha compartilhada para ele.
 * @access CPPP_COLLECT
 */
router.post('/devices',
    authMiddleware, canAny(CAN_COLLECT),
    validate(postDeviceSchema),
    asyncHandler(collectController.createDevice));

/**
 * @route PUT /cppp/devices/:id
 * @description Nome, IP, REP e ativo. O código não muda. Não há DELETE: o
 * espelho referencia o relógio para sempre — desative.
 * @access CPPP_COLLECT
 */
router.put('/devices/:id',
    authMiddleware, canAny(CAN_COLLECT),
    validate(putDeviceSchema),
    asyncHandler(collectController.updateDevice));

/**
 * @route POST /cppp/devices/test-connection
 * @description Testa um IP antes de salvar: login + logout, nada mais.
 * @access CPPP_COLLECT
 */
router.post('/devices/test-connection',
    authMiddleware, canAny(CAN_COLLECT),
    validate(testConnectionSchema),
    asyncHandler(collectController.testAddress));

/** @route POST /cppp/devices/:id/test-connection  @access CPPP_COLLECT */
router.post('/devices/:id/test-connection',
    authMiddleware, canAny(CAN_COLLECT),
    asyncHandler(collectController.testDevice));

/** @access CPPP_USE */
router.get('/collect-runs',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(collectController.listRuns));

/** @access CPPP_USE */
router.get('/collect-runs/:id',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(collectController.getRun));

/**
 * @route POST /cppp/collect-runs
 * @description Enfileira uma coleta. ⚠️ NÃO fala com o relógio: quem coleta
 * é o worker `cppp-afd-collector`, em segundos. 409 se o relógio já tem
 * coleta na fila ou em andamento.
 * @access CPPP_COLLECT
 */
router.post('/collect-runs',
    authMiddleware, canAny(CAN_COLLECT),
    validate(postCollectRunSchema),
    asyncHandler(collectController.requestCollect));

/**
 * @route GET /cppp/collect-runs/:id/afd
 * @description O AFD bruto da coleta, byte a byte, conferido pelo SHA-256.
 * @access CPPP_COLLECT
 */
router.get('/collect-runs/:id/afd',
    authMiddleware, canAny(CAN_COLLECT),
    asyncHandler(collectController.downloadRawAfd));

module.exports = router;
