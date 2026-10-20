/**
 * @fileoverview Roteador da suite REPP — Reserva de Espaços Peg Pese (Sala de
 * Treinamento, Auditório, ...). Tabelas `re_*` no MySQL `global`.
 *
 * Montado pelo `routes.js` do global sob `/spaces`.
 *
 * ─── Três níveis de acesso ───────────────────────────────────────────────────
 * - Consulta (GET da agenda e dos espaços) é PÚBLICA: `optionalAuth` identifica
 *   quem tem sessão e segue anônimo quem não tem, sem nunca responder 401. O
 *   mascaramento é decidido no backend, por espaço e por reserva — o front só
 *   lê `can_view_details` / `can_manage` / `can_review`.
 * - Escrita exige sessão (`authMiddleware`). Quem pode o quê não é permissão
 *   do `canAny`: depende do espaço (`re_space_admins`) e da autoria, então é
 *   decidido no caso de uso (`domain/repp/booking-access.rules.js`).
 *   `SYSTEM_OWNER` é o "dono do sistema" e pode tudo.
 *
 * | Rota                                   | Acesso                                   |
 * |----------------------------------------|------------------------------------------|
 * | `GET   /spaces`                        | público                                  |
 * | `GET   /spaces/me/managed`             | logado (`?include_inactive=true`)        |
 * | `POST  /spaces`                        | dono (nasce com ≥ 1 administrador)       |
 * | `PUT   /spaces/:id`                    | dono; admin do espaço só agenda          |
 * | `GET   /spaces/bookings`               | público (máx. 62 dias)                   |
 * | `GET   /spaces/bookings/mine`          | logado (as que criou, todos os status)   |
 * | `GET   /spaces/bookings/pending`       | administrador de espaço / dono           |
 * | `GET   /spaces/bookings/:id`           | público                                  |
 * | `POST  /spaces/bookings`               | logado (não-admin nasce `pending`)       |
 * | `PUT   /spaces/bookings/:id`           | admin do espaço / dono / criador         |
 * | `PATCH /spaces/bookings/:id/cancel`    | admin do espaço / dono / criador         |
 * | `PATCH /spaces/bookings/:id/approve`   | admin do espaço / dono                   |
 * | `PATCH /spaces/bookings/:id/reject`    | admin do espaço / dono                   |
 * | `GET   /spaces/notifications`          | logado (não lidas; não apaga)            |
 * | `PATCH /spaces/notifications/read`     | logado (`{ ids }`, idempotente)          |
 * | `POST  /spaces/:id/unblocked-dates`    | admin do espaço / dono (`{ date }`)      |
 * | `DELETE /spaces/:id/unblocked-dates/:date` | admin do espaço / dono               |
 * | `GET   /spaces/:id/admins`             | admin do espaço / dono                   |
 * | `POST  /spaces/:id/admins`             | dono (`{ user_id }`, idempotente)        |
 * | `DELETE /spaces/:id/admins/:userId`    | dono (idempotente; nunca o último ativo) |
 *
 * Cancelar, aprovar, recusar, editar, pedir (reserva pendente) e reservar
 * direto (administrador) gravam aviso em `re_notifications` e emitem
 * `repp:event` no WebSocket com o mesmo `id`.
 *
 * As rotas públicas caem no `apiLimiter` (por IP) de `app.factory`, como
 * qualquer tráfego sem sessão.
 *
 * Detalhes, decisões e pontas soltas: `docs/repp.md`.
 *
 * @module modules/global/repp.routes
 */

const express = require('express');

const router = express.Router();

const spaceController = require('./controllers/repp-space.controller');
const bookingController = require('./controllers/repp-booking.controller');
const notificationController = require('./controllers/repp-notification.controller');

const authMiddleware = require('../../middlewares/auth.middleware');
const { optionalAuth } = require('../../middlewares/optional-auth.middleware');
const { asyncHandler } = require('../../middlewares/async-handler.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const {
    postBookingSchema, putBookingSchema, reasonSchema, unblockDateSchema, spaceAdminSchema, postSpaceSchema, putSpaceSchema,
} = require('../../schemas/repp.schema');

// ─── Espaços ─────────────────────────────────────────────────────────────────

/**
 * @route GET /spaces
 * @description Espaços ativos, cada um com as flags de quem consulta
 * (`can_view_details`, `can_manage`, `can_review`, `can_book`,
 * `requires_approval`).
 * @access público
 */
router.get('/',
    optionalAuth,
    asyncHandler(spaceController.list));

/**
 * @route GET /spaces/me/managed?include_inactive=true
 * @description Espaços que o usuário administra (dono do sistema: todos).
 * Com `include_inactive=true`, também os desativados (`active: false`).
 * @access logado
 */
router.get('/me/managed',
    authMiddleware,
    asyncHandler(spaceController.listManaged));

/**
 * @route POST /spaces
 * @description Cadastra o espaço (`{ name, description?, blocked_weekdays?,
 * setup_minutes?, admin_user_ids }`) com os administradores iniciais, na
 * mesma transação. 409 `REPP_SPACE_NAME_TAKEN` se o nome já existe. Devolve o
 * espaço no formato do `GET /spaces`.
 * @access dono do sistema
 */
router.post('/',
    authMiddleware,
    validate(postSpaceSchema),
    asyncHandler(spaceController.create));

/**
 * @route PUT /spaces/:id
 * @description Edita (campos ausentes ficam): `name`, `description`,
 * `active` (só o dono) e `blocked_weekdays`, `setup_minutes` (dono ou admin
 * do espaço). Desativar não mexe nas reservas já feitas. Devolve o espaço.
 * @access dono do sistema; administrador do espaço só nos campos de agenda
 */
router.put('/:id',
    authMiddleware,
    validate(putSpaceSchema),
    asyncHandler(spaceController.update));

/**
 * @route POST /spaces/:id/unblocked-dates
 * @description Libera para todos uma data (`{ date: 'YYYY-MM-DD' }`) que cai
 * num dia da semana bloqueado do espaço. Idempotente. Devolve o espaço.
 * @access administrador do espaço ou dono do sistema
 */
router.post('/:id/unblocked-dates',
    authMiddleware,
    validate(unblockDateSchema),
    asyncHandler(spaceController.unblockDate));

/**
 * @route DELETE /spaces/:id/unblocked-dates/:date
 * @description Volta a bloquear a data. Idempotente; reservas já feitas nela
 * continuam valendo. Devolve o espaço.
 * @access administrador do espaço ou dono do sistema
 */
router.delete('/:id/unblocked-dates/:date',
    authMiddleware,
    asyncHandler(spaceController.reblockDate));

/**
 * @route GET /spaces/:id/admins
 * @description Administradores do espaço (`re_space_admins`), por nome.
 * Devolve `{ space_id, can_manage_admins, items }`.
 * @access administrador do espaço ou dono do sistema
 */
router.get('/:id/admins',
    authMiddleware,
    asyncHandler(spaceController.listAdmins));

/**
 * @route POST /spaces/:id/admins
 * @description Torna um usuário ativo administrador do espaço
 * (`{ user_id }`). Idempotente. Devolve a lista atualizada.
 * @access dono do sistema
 */
router.post('/:id/admins',
    authMiddleware,
    validate(spaceAdminSchema),
    asyncHandler(spaceController.addAdmin));

/**
 * @route DELETE /spaces/:id/admins/:userId
 * @description Remove o vínculo. Idempotente; 409 se o espaço ficaria sem
 * administrador ativo. Devolve a lista atualizada.
 * @access dono do sistema
 */
router.delete('/:id/admins/:userId',
    authMiddleware,
    asyncHandler(spaceController.removeAdmin));

// ─── Reservas ────────────────────────────────────────────────────────────────

/**
 * @route GET /spaces/bookings?start=YYYY-MM-DD&end=YYYY-MM-DD&space_id=
 * @description Pendentes e aprovadas do intervalo (no máximo 62 dias). Quem
 * não administra o espaço nem criou a reserva recebe só espaço, data,
 * horário e status — os demais campos não existem no objeto.
 * @access público
 */
router.get('/bookings',
    optionalAuth,
    asyncHandler(bookingController.list));

/**
 * @route GET /spaces/bookings/mine?status=&start=&end=&space_id=&page=&limit=
 * @description As reservas que o usuário criou, em qualquer status (é onde
 * ele encontra a recusada ou cancelada), mais recentes primeiro, paginadas.
 * Declarada antes de `/bookings/:id` para não ser lida como id.
 * @access logado
 */
router.get('/bookings/mine',
    authMiddleware,
    asyncHandler(bookingController.listMine));

/**
 * @route GET /spaces/bookings/pending
 * @description Fila de aprovação dos espaços que o usuário administra.
 * Declarada antes de `/bookings/:id` para não ser lida como id.
 * @access administrador de espaço ou dono do sistema
 */
router.get('/bookings/pending',
    authMiddleware,
    asyncHandler(bookingController.listPending));

/**
 * @route GET /spaces/bookings/:id
 * @description Detalhe, com o mesmo mascaramento da agenda.
 * @access público
 */
router.get('/bookings/:id',
    optionalAuth,
    asyncHandler(bookingController.getById));

/**
 * @route POST /spaces/bookings
 * @description Cria. Administrador do espaço e dono reservam direto
 * (`approved`); os demais entram como `pending`. 409 com o intervalo que
 * conflita (sem dados de quem reservou).
 * @access logado
 */
router.post('/bookings',
    authMiddleware,
    validate(postBookingSchema),
    asyncHandler(bookingController.create));

/**
 * @route PUT /spaces/bookings/:id
 * @description Edita (campos ausentes ficam). Criador que troca espaço, data
 * ou horário devolve a reserva para `pending` e solta o horário antigo.
 * @access administrador do espaço, dono do sistema ou criador
 */
router.put('/bookings/:id',
    authMiddleware,
    validate(putBookingSchema),
    asyncHandler(bookingController.update));

/**
 * @route PATCH /spaces/bookings/:id/cancel
 * @description Soft delete (`status = canceled`). Só antes de começar.
 * @access administrador do espaço, dono do sistema ou criador
 */
router.patch('/bookings/:id/cancel',
    authMiddleware,
    validate(reasonSchema),
    asyncHandler(bookingController.cancel));

/** @route PATCH /spaces/bookings/:id/approve  @access administrador do espaço ou dono */
router.patch('/bookings/:id/approve',
    authMiddleware,
    asyncHandler(bookingController.approve));

/** @route PATCH /spaces/bookings/:id/reject  @access administrador do espaço ou dono */
router.patch('/bookings/:id/reject',
    authMiddleware,
    validate(reasonSchema),
    asyncHandler(bookingController.reject));

// ─── Notificações ────────────────────────────────────────────────────────────

/**
 * @route GET /spaces/notifications
 * @description Não lidas do usuário, mais recentes primeiro. Buscar NÃO marca
 * como lida nem apaga.
 * @access logado
 */
router.get('/notifications',
    authMiddleware,
    asyncHandler(notificationController.listUnread));

/**
 * @route PATCH /spaces/notifications/read
 * @description Marca como lidas (`{ ids: number[] }`). Id já lido ou de outra
 * pessoa é ignorado sem erro. Lidas há mais de 30 dias são apagadas.
 * @access logado
 */
router.patch('/notifications/read',
    authMiddleware,
    asyncHandler(notificationController.markRead));

module.exports = router;
