/**
 * @fileoverview Roteador da suite miepp (Mídia Interna e Externa Peg Pese).
 *
 * Montado pelo `routes.js` do global sob `/miepp`, então a URL final em
 * produção é `https://vagas.gpprh.com.br/api/v1/global/miepp/...`.
 *
 * ─── Três zonas de autenticação, sem mistura ─────────────────────────────────
 *
 * | Zona                       | Quem entra                           | Como |
 * |----------------------------|--------------------------------------|------|
 * | `/miepp/...` (painel)      | usuário do painel                    | cookie de sessão (`authMiddleware`) + permissão (`canAny`) |
 * | `/miepp/device/...`        | o player Android                     | `Authorization: Bearer <token>` (`authenticateDevice`) |
 * | `/miepp/media/:uuid/file`  | o player, baixando o binário         | assinatura HMAC na query (`?t=`) |
 *
 * As três são disjuntas de propósito: `req.user`, `req.device` e a assinatura
 * nunca se convertem uma na outra. Um token de player não alcança nenhuma rota
 * administrativa, e um cookie de painel não serve para baixar mídia assinada.
 *
 * ─── Papéis ──────────────────────────────────────────────────────────────────
 * `viewer` lê tudo; `editor` também escreve conteúdo; `admin` ainda gere
 * usuários, desativa players, revoga token e lê a auditoria. Ver
 * `domain/miepp/miepp-access.rules`.
 *
 * Toda rota de escrita do painel passa por `audit(...)`, que grava em
 * `miepp_audit_log` automaticamente — nenhum controller faz isso à mão.
 *
 * @module modules/global/miepp.routes
 */

const express = require('express');

const router = express.Router();

const locationController = require('./controllers/miepp-location.controller');
const playerController = require('./controllers/miepp-player.controller');
const groupController = require('./controllers/miepp-player-group.controller');
const mediaController = require('./controllers/miepp-media.controller');
const playlistController = require('./controllers/miepp-playlist.controller');
const scheduleController = require('./controllers/miepp-schedule.controller');
const deviceController = require('./controllers/miepp-device.controller');
const auditController = require('./controllers/miepp-audit.controller');

const authMiddleware = require('../../middlewares/auth.middleware');
const { asyncHandler } = require('../../middlewares/async-handler.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const { audit } = require('../../middlewares/miepp-audit.middleware');
const { authenticateDevice } = require('../../middlewares/miepp-device-auth.middleware');
const { deviceLimiter } = require('../../middlewares/rate-limit.middleware');
const { canAny } = require('../../middlewares/permission.middleware');
const {
    CAN_READ,
    CAN_WRITE,
    CAN_ADMINISTER,
} = require('./domain/miepp/miepp-access.rules');
const { upload: fileUpload } = require('../../utils/file/file.service');

const {
    postLocationSchema, putLocationSchema,
    postPlayerSchema, putPlayerSchema, postCommandSchema,
    postGroupSchema, putGroupSchema, postGroupMemberSchema,
    postMediaSchema, putMediaSchema,
    postPlaylistSchema, putPlaylistSchema, postPlaylistItemSchema, putPlaylistItemSchema,
    postScheduleSchema, putScheduleSchema, postScheduleTargetSchema,
    postPairSchema, postHeartbeatSchema, postCommandAckSchema,
} = require('../../schemas/miepp.schema');

// ═══════════════════════════════════════════════════════════════════════════
// ROTAS DO DISPOSITIVO — declaradas ANTES das administrativas
//
// A ordem importa: `/device/...` precisa casar antes de qualquer rota do
// painel, e nenhuma delas pode passar pelo `authMiddleware` (o player não tem
// cookie). Mantidas juntas no topo para que ninguém acrescente uma rota de
// device no meio do bloco administrativo e a faça exigir sessão sem querer.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route POST /miepp/device/pair
 * @description Troca o código de pareamento pelo token do dispositivo. O token
 * é devolvido em texto puro UMA única vez — o banco guarda só o SHA-256.
 * @access Público (autorizado pelo próprio código de pareamento)
 */
router.post('/device/pair',
    deviceLimiter,
    validate(postPairSchema),
    asyncHandler(deviceController.pair));

/**
 * @route GET /miepp/device/playlist
 * @description Playlist que este player deve tocar agora, já resolvida pelo
 * agendamento vigente e com as URLs de mídia assinadas.
 * @access Token de dispositivo
 */
router.get('/device/playlist',
    deviceLimiter,
    authenticateDevice,
    asyncHandler(deviceController.getPlaylist));

/**
 * @route POST /miepp/device/heartbeat
 * @description Recebe o status do player, atualiza `last_seen_at`/`status`/
 * `last_ip` e grava um evento em `miepp_player_status_log`.
 * @access Token de dispositivo
 */
router.post('/device/heartbeat',
    deviceLimiter,
    authenticateDevice,
    validate(postHeartbeatSchema),
    asyncHandler(deviceController.heartbeat));

/**
 * @route GET /miepp/device/commands/pending
 * @description Comandos pendentes deste player; entrega e marca como `sent`.
 * @access Token de dispositivo
 */
router.get('/device/commands/pending',
    deviceLimiter,
    authenticateDevice,
    asyncHandler(deviceController.pendingCommands));

/**
 * @route POST /miepp/device/commands/:id/ack
 * @description Confirma execução (`acknowledged`) ou falha (`failed`).
 * @access Token de dispositivo
 */
router.post('/device/commands/:id/ack',
    deviceLimiter,
    authenticateDevice,
    validate(postCommandAckSchema),
    asyncHandler(deviceController.ackCommand));

// ═══════════════════════════════════════════════════════════════════════════
// ENTREGA DE MÍDIA — autorizada pela assinatura na query
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route GET /miepp/media/:uuid/file?t=<token>&p=<playerId>
 * @description Serve o binário da mídia. Sem sessão e sem token de device: a
 * autorização é a assinatura HMAC emitida em `GET /miepp/device/playlist`,
 * válida por poucas horas.
 *
 * Declarada ANTES das rotas do painel de propósito — `/media/:id` casaria
 * `/media/<uuid>` e passaria a exigir sessão, que o player não tem.
 * @access Assinatura de curta duração
 */
router.get('/media/:uuid/file',
    deviceLimiter,
    asyncHandler(mediaController.serveFile));

// ═══════════════════════════════════════════════════════════════════════════
// PAINEL — daqui para baixo, tudo exige sessão de usuário e permissão
// ═══════════════════════════════════════════════════════════════════════════

// ─── Locais ──────────────────────────────────────────────────────────────────

router.get('/locations',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(locationController.list));

router.get('/locations/:id',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(locationController.getById));

router.post('/locations',
    authMiddleware, canAny(CAN_WRITE),
    validate(postLocationSchema), audit('location'),
    asyncHandler(locationController.create));

router.put('/locations/:id',
    authMiddleware, canAny(CAN_WRITE),
    validate(putLocationSchema), audit('location'),
    asyncHandler(locationController.update));

router.delete('/locations/:id',
    authMiddleware, canAny(CAN_WRITE),
    audit('location'),
    asyncHandler(locationController.remove));

// ─── Players ─────────────────────────────────────────────────────────────────

router.get('/players',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(playerController.list));

router.get('/players/:id',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(playerController.getById));

router.post('/players',
    authMiddleware, canAny(CAN_WRITE),
    validate(postPlayerSchema), audit('player'),
    asyncHandler(playerController.create));

router.put('/players/:id',
    authMiddleware, canAny(CAN_WRITE),
    validate(putPlayerSchema), audit('player'),
    asyncHandler(playerController.update));

/**
 * @route DELETE /miepp/players/:id
 * @description Soft-delete (`active = 0`) e revogação dos tokens do player.
 * @access admin
 */
router.delete('/players/:id',
    authMiddleware, canAny(CAN_ADMINISTER),
    audit('player', { action: 'deactivate' }),
    asyncHandler(playerController.deactivate));

/**
 * @route POST /miepp/players/:id/pairing-code
 * @description Emite o código de pareamento de curta duração.
 * @access admin
 */
router.post('/players/:id/pairing-code',
    authMiddleware, canAny(CAN_ADMINISTER),
    audit('player', { action: 'issue_pairing_code' }),
    asyncHandler(playerController.issuePairingCode));

/**
 * @route POST /miepp/players/:id/revoke-token
 * @description Revoga os tokens vivos do player; a tela volta a pedir pareamento.
 * @access admin
 */
router.post('/players/:id/revoke-token',
    authMiddleware, canAny(CAN_ADMINISTER),
    audit('player', { action: 'revoke_token' }),
    asyncHandler(playerController.revokeTokens));

/**
 * @route POST /miepp/players/:id/commands
 * @description Enfileira um comando remoto (`reboot`, `reload_playlist`,
 * `clear_cache`, `screenshot`).
 * @access editor
 */
router.post('/players/:id/commands',
    authMiddleware, canAny(CAN_WRITE),
    validate(postCommandSchema), audit('command'),
    asyncHandler(playerController.enqueueCommand));

router.get('/players/:id/commands',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(playerController.listCommands));

router.get('/players/:id/status-log',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(playerController.listStatusLog));

// ─── Grupos de players ───────────────────────────────────────────────────────

router.get('/player-groups',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(groupController.list));

router.get('/player-groups/:id',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(groupController.getById));

router.post('/player-groups',
    authMiddleware, canAny(CAN_WRITE),
    validate(postGroupSchema), audit('player_group'),
    asyncHandler(groupController.create));

router.put('/player-groups/:id',
    authMiddleware, canAny(CAN_WRITE),
    validate(putGroupSchema), audit('player_group'),
    asyncHandler(groupController.update));

router.delete('/player-groups/:id',
    authMiddleware, canAny(CAN_WRITE),
    audit('player_group'),
    asyncHandler(groupController.remove));

router.post('/player-groups/:id/players',
    authMiddleware, canAny(CAN_WRITE),
    validate(postGroupMemberSchema), audit('player_group', { action: 'add_member' }),
    asyncHandler(groupController.addMember));

router.delete('/player-groups/:id/players/:playerId',
    authMiddleware, canAny(CAN_WRITE),
    audit('player_group', { action: 'remove_member' }),
    asyncHandler(groupController.removeMember));

// ─── Mídia ───────────────────────────────────────────────────────────────────

router.get('/media',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(mediaController.list));

router.get('/media/:id',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(mediaController.getById));

/**
 * @route POST /miepp/media
 * @description Cadastra uma mídia. `image`/`video`/`html` exigem o arquivo no
 * campo `file` (multipart); `weburl` exige o campo `url` e não tem binário.
 * @access editor
 */
router.post('/media',
    authMiddleware, canAny(CAN_WRITE),
    fileUpload.single('file'),
    validate(postMediaSchema), audit('media'),
    asyncHandler(mediaController.create));

router.put('/media/:id',
    authMiddleware, canAny(CAN_WRITE),
    validate(putMediaSchema), audit('media'),
    asyncHandler(mediaController.update));

router.delete('/media/:id',
    authMiddleware, canAny(CAN_WRITE),
    audit('media'),
    asyncHandler(mediaController.remove));

// ─── Playlists ───────────────────────────────────────────────────────────────

router.get('/playlists',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(playlistController.list));

router.get('/playlists/:id',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(playlistController.getById));

router.post('/playlists',
    authMiddleware, canAny(CAN_WRITE),
    validate(postPlaylistSchema), audit('playlist'),
    asyncHandler(playlistController.create));

router.put('/playlists/:id',
    authMiddleware, canAny(CAN_WRITE),
    validate(putPlaylistSchema), audit('playlist'),
    asyncHandler(playlistController.update));

router.delete('/playlists/:id',
    authMiddleware, canAny(CAN_WRITE),
    audit('playlist'),
    asyncHandler(playlistController.remove));

router.get('/playlists/:id/items',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(playlistController.listItems));

/**
 * @route PATCH /miepp/playlists/:id/items/reorder
 * @description Grava a ordem completa dos itens. Body: `{ item_ids: [...] }`.
 *
 * Declarada ANTES de `/playlists/:id/items/:itemId`: sem isso, `reorder` casaria
 * como `:itemId` e a reordenação viraria um update de item inexistente.
 * @access editor
 */
router.patch('/playlists/:id/items/reorder',
    authMiddleware, canAny(CAN_WRITE),
    audit('playlist', { action: 'reorder_items' }),
    asyncHandler(playlistController.reorderItems));

router.post('/playlists/:id/items',
    authMiddleware, canAny(CAN_WRITE),
    validate(postPlaylistItemSchema), audit('playlist_item'),
    asyncHandler(playlistController.addItem));

router.put('/playlists/:id/items/:itemId',
    authMiddleware, canAny(CAN_WRITE),
    validate(putPlaylistItemSchema), audit('playlist_item'),
    asyncHandler(playlistController.updateItem));

router.delete('/playlists/:id/items/:itemId',
    authMiddleware, canAny(CAN_WRITE),
    audit('playlist_item'),
    asyncHandler(playlistController.removeItem));

// ─── Agendamentos ────────────────────────────────────────────────────────────

router.get('/schedules',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(scheduleController.list));

router.get('/schedules/:id',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(scheduleController.getById));

router.post('/schedules',
    authMiddleware, canAny(CAN_WRITE),
    validate(postScheduleSchema), audit('schedule'),
    asyncHandler(scheduleController.create));

router.put('/schedules/:id',
    authMiddleware, canAny(CAN_WRITE),
    validate(putScheduleSchema), audit('schedule'),
    asyncHandler(scheduleController.update));

router.delete('/schedules/:id',
    authMiddleware, canAny(CAN_WRITE),
    audit('schedule'),
    asyncHandler(scheduleController.remove));

router.get('/schedules/:id/targets',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(scheduleController.listTargets));

router.post('/schedules/:id/targets',
    authMiddleware, canAny(CAN_WRITE),
    validate(postScheduleTargetSchema), audit('schedule_target'),
    asyncHandler(scheduleController.addTarget));

router.delete('/schedules/:id/targets/:targetId',
    authMiddleware, canAny(CAN_WRITE),
    audit('schedule_target'),
    asyncHandler(scheduleController.removeTarget));

// ─── Auditoria (somente admin) ───────────────────────────────────────────────

/**
 * @route GET /miepp/audit-log?entity_type=player&user_id=3&page=1&limit=50
 * @description Trilha de auditoria, paginada e filtrável.
 * @access admin
 */
router.get('/audit-log',
    authMiddleware, canAny(CAN_ADMINISTER),
    asyncHandler(auditController.list));

module.exports = router;
