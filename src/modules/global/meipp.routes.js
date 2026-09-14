/**
 * @fileoverview Roteador da suite meipp (Mídia Interna e Externa Peg Pese).
 *
 * Montado pelo `routes.js` do global sob `/meipp`, então a URL final em
 * produção é `https://vagas.gpprh.com.br/api/v1/global/meipp/...`.
 *
 * ─── Três zonas de autenticação, sem mistura ─────────────────────────────────
 *
 * | Zona                       | Quem entra                           | Como |
 * |----------------------------|--------------------------------------|------|
 * | `/meipp/...` (painel)      | usuário do painel                    | cookie de sessão (`authMiddleware`) + papel (`requireMeippRole`) |
 * | `/meipp/device/...`        | o player Android                     | `Authorization: Bearer <token>` (`authenticateDevice`) |
 * | `/meipp/media/:uuid/file`  | o player, baixando o binário         | assinatura HMAC na query (`?t=`) |
 *
 * As três são disjuntas de propósito: `req.user`, `req.device` e a assinatura
 * nunca se convertem uma na outra. Um token de player não alcança nenhuma rota
 * administrativa, e um cookie de painel não serve para baixar mídia assinada.
 *
 * ─── Papéis ──────────────────────────────────────────────────────────────────
 * `viewer` lê tudo; `editor` também escreve conteúdo; `admin` ainda gere
 * usuários, desativa players, revoga token e lê a auditoria. Ver
 * `domain/meipp/meipp-access.rules`.
 *
 * Toda rota de escrita do painel passa por `audit(...)`, que grava em
 * `meipp_audit_log` automaticamente — nenhum controller faz isso à mão.
 *
 * @module modules/global/meipp.routes
 */

const express = require('express');

const router = express.Router();

const locationController = require('./controllers/meipp-location.controller');
const userController = require('./controllers/meipp-user.controller');
const playerController = require('./controllers/meipp-player.controller');
const groupController = require('./controllers/meipp-player-group.controller');
const mediaController = require('./controllers/meipp-media.controller');
const playlistController = require('./controllers/meipp-playlist.controller');
const scheduleController = require('./controllers/meipp-schedule.controller');
const deviceController = require('./controllers/meipp-device.controller');
const auditController = require('./controllers/meipp-audit.controller');

const authMiddleware = require('../../middlewares/auth.middleware');
const { asyncHandler } = require('../../middlewares/async-handler.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const { audit } = require('../../middlewares/meipp-audit.middleware');
const { authenticateDevice } = require('../../middlewares/meipp-device-auth.middleware');
const { deviceLimiter } = require('../../middlewares/rate-limit.middleware');
const {
    requireMeippViewer,
    requireMeippEditor,
    requireMeippAdmin,
} = require('../../middlewares/meipp-role.middleware');
const { upload: fileUpload } = require('../../utils/file/file.service');

const {
    postLocationSchema, putLocationSchema,
    postUserSchema, putUserSchema,
    postPlayerSchema, putPlayerSchema, postCommandSchema,
    postGroupSchema, putGroupSchema, postGroupMemberSchema,
    postMediaSchema, putMediaSchema,
    postPlaylistSchema, putPlaylistSchema, postPlaylistItemSchema, putPlaylistItemSchema,
    postScheduleSchema, putScheduleSchema, postScheduleTargetSchema,
    postPairSchema, postHeartbeatSchema, postCommandAckSchema,
} = require('../../schemas/meipp.schema');

// ═══════════════════════════════════════════════════════════════════════════
// ROTAS DO DISPOSITIVO — declaradas ANTES das administrativas
//
// A ordem importa: `/device/...` precisa casar antes de qualquer rota do
// painel, e nenhuma delas pode passar pelo `authMiddleware` (o player não tem
// cookie). Mantidas juntas no topo para que ninguém acrescente uma rota de
// device no meio do bloco administrativo e a faça exigir sessão sem querer.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route POST /meipp/device/pair
 * @description Troca o código de pareamento pelo token do dispositivo. O token
 * é devolvido em texto puro UMA única vez — o banco guarda só o SHA-256.
 * @access Público (autorizado pelo próprio código de pareamento)
 */
router.post('/device/pair',
    deviceLimiter,
    validate(postPairSchema),
    asyncHandler(deviceController.pair));

/**
 * @route GET /meipp/device/playlist
 * @description Playlist que este player deve tocar agora, já resolvida pelo
 * agendamento vigente e com as URLs de mídia assinadas.
 * @access Token de dispositivo
 */
router.get('/device/playlist',
    deviceLimiter,
    authenticateDevice,
    asyncHandler(deviceController.getPlaylist));

/**
 * @route POST /meipp/device/heartbeat
 * @description Recebe o status do player, atualiza `last_seen_at`/`status`/
 * `last_ip` e grava um evento em `meipp_player_status_log`.
 * @access Token de dispositivo
 */
router.post('/device/heartbeat',
    deviceLimiter,
    authenticateDevice,
    validate(postHeartbeatSchema),
    asyncHandler(deviceController.heartbeat));

/**
 * @route GET /meipp/device/commands/pending
 * @description Comandos pendentes deste player; entrega e marca como `sent`.
 * @access Token de dispositivo
 */
router.get('/device/commands/pending',
    deviceLimiter,
    authenticateDevice,
    asyncHandler(deviceController.pendingCommands));

/**
 * @route POST /meipp/device/commands/:id/ack
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
 * @route GET /meipp/media/:uuid/file?t=<token>&p=<playerId>
 * @description Serve o binário da mídia. Sem sessão e sem token de device: a
 * autorização é a assinatura HMAC emitida em `GET /meipp/device/playlist`,
 * válida por poucas horas.
 * @access Assinatura de curta duração
 */
router.get('/media/:uuid/file',
    deviceLimiter,
    asyncHandler(mediaController.serveFile));

// ═══════════════════════════════════════════════════════════════════════════
// PAINEL — daqui para baixo, tudo exige sessão de usuário
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route GET /meipp/me
 * @description Papel do usuário da sessão dentro do meipp. O painel usa para
 * decidir o que mostrar.
 * @access Qualquer papel
 */
router.get('/me',
    authMiddleware,
    requireMeippViewer(),
    asyncHandler(userController.me));

// ─── Locais ──────────────────────────────────────────────────────────────────

router.get('/locations',
    authMiddleware, requireMeippViewer(),
    asyncHandler(locationController.list));

router.get('/locations/:id',
    authMiddleware, requireMeippViewer(),
    asyncHandler(locationController.getById));

router.post('/locations',
    authMiddleware, requireMeippEditor(),
    validate(postLocationSchema), audit('location'),
    asyncHandler(locationController.create));

router.put('/locations/:id',
    authMiddleware, requireMeippEditor(),
    validate(putLocationSchema), audit('location'),
    asyncHandler(locationController.update));

router.delete('/locations/:id',
    authMiddleware, requireMeippEditor(),
    audit('location'),
    asyncHandler(locationController.remove));

// ─── Usuários do painel (somente admin) ──────────────────────────────────────

router.get('/users',
    authMiddleware, requireMeippAdmin(),
    asyncHandler(userController.list));

router.get('/users/:id',
    authMiddleware, requireMeippAdmin(),
    asyncHandler(userController.getById));

router.post('/users',
    authMiddleware, requireMeippAdmin(),
    validate(postUserSchema), audit('user'),
    asyncHandler(userController.create));

router.put('/users/:id',
    authMiddleware, requireMeippAdmin(),
    validate(putUserSchema), audit('user'),
    asyncHandler(userController.update));

/**
 * @route DELETE /meipp/users/:id
 * @description Desativa o acesso (`active = 0`). Não apaga a linha: as FKs de
 * autoria são ON DELETE SET NULL e a remoção apagaria o histórico da pessoa.
 * @access admin
 */
router.delete('/users/:id',
    authMiddleware, requireMeippAdmin(),
    audit('user', { action: 'deactivate' }),
    asyncHandler(userController.deactivate));

// ─── Players ─────────────────────────────────────────────────────────────────

router.get('/players',
    authMiddleware, requireMeippViewer(),
    asyncHandler(playerController.list));

router.get('/players/:id',
    authMiddleware, requireMeippViewer(),
    asyncHandler(playerController.getById));

router.post('/players',
    authMiddleware, requireMeippEditor(),
    validate(postPlayerSchema), audit('player'),
    asyncHandler(playerController.create));

router.put('/players/:id',
    authMiddleware, requireMeippEditor(),
    validate(putPlayerSchema), audit('player'),
    asyncHandler(playerController.update));

/**
 * @route DELETE /meipp/players/:id
 * @description Soft-delete (`active = 0`) e revogação dos tokens do player.
 * @access admin
 */
router.delete('/players/:id',
    authMiddleware, requireMeippAdmin(),
    audit('player', { action: 'deactivate' }),
    asyncHandler(playerController.deactivate));

/**
 * @route POST /meipp/players/:id/pairing-code
 * @description Emite o código de pareamento de curta duração.
 * @access admin
 */
router.post('/players/:id/pairing-code',
    authMiddleware, requireMeippAdmin(),
    audit('player', { action: 'issue_pairing_code' }),
    asyncHandler(playerController.issuePairingCode));

/**
 * @route POST /meipp/players/:id/revoke-token
 * @description Revoga os tokens vivos do player; a tela volta a pedir pareamento.
 * @access admin
 */
router.post('/players/:id/revoke-token',
    authMiddleware, requireMeippAdmin(),
    audit('player', { action: 'revoke_token' }),
    asyncHandler(playerController.revokeTokens));

/**
 * @route POST /meipp/players/:id/commands
 * @description Enfileira um comando remoto (`reboot`, `reload_playlist`,
 * `clear_cache`, `screenshot`).
 * @access editor
 */
router.post('/players/:id/commands',
    authMiddleware, requireMeippEditor(),
    validate(postCommandSchema), audit('command'),
    asyncHandler(playerController.enqueueCommand));

router.get('/players/:id/commands',
    authMiddleware, requireMeippViewer(),
    asyncHandler(playerController.listCommands));

router.get('/players/:id/status-log',
    authMiddleware, requireMeippViewer(),
    asyncHandler(playerController.listStatusLog));

// ─── Grupos de players ───────────────────────────────────────────────────────

router.get('/player-groups',
    authMiddleware, requireMeippViewer(),
    asyncHandler(groupController.list));

router.get('/player-groups/:id',
    authMiddleware, requireMeippViewer(),
    asyncHandler(groupController.getById));

router.post('/player-groups',
    authMiddleware, requireMeippEditor(),
    validate(postGroupSchema), audit('player_group'),
    asyncHandler(groupController.create));

router.put('/player-groups/:id',
    authMiddleware, requireMeippEditor(),
    validate(putGroupSchema), audit('player_group'),
    asyncHandler(groupController.update));

router.delete('/player-groups/:id',
    authMiddleware, requireMeippEditor(),
    audit('player_group'),
    asyncHandler(groupController.remove));

router.post('/player-groups/:id/players',
    authMiddleware, requireMeippEditor(),
    validate(postGroupMemberSchema), audit('player_group', { action: 'add_member' }),
    asyncHandler(groupController.addMember));

router.delete('/player-groups/:id/players/:playerId',
    authMiddleware, requireMeippEditor(),
    audit('player_group', { action: 'remove_member' }),
    asyncHandler(groupController.removeMember));

// ─── Mídia ───────────────────────────────────────────────────────────────────

router.get('/media',
    authMiddleware, requireMeippViewer(),
    asyncHandler(mediaController.list));

router.get('/media/:id',
    authMiddleware, requireMeippViewer(),
    asyncHandler(mediaController.getById));

/**
 * @route POST /meipp/media
 * @description Cadastra uma mídia. `image`/`video`/`html` exigem o arquivo no
 * campo `file` (multipart); `weburl` exige o campo `url` e não tem binário.
 * @access editor
 */
router.post('/media',
    authMiddleware, requireMeippEditor(),
    fileUpload.single('file'),
    validate(postMediaSchema), audit('media'),
    asyncHandler(mediaController.create));

router.put('/media/:id',
    authMiddleware, requireMeippEditor(),
    validate(putMediaSchema), audit('media'),
    asyncHandler(mediaController.update));

router.delete('/media/:id',
    authMiddleware, requireMeippEditor(),
    audit('media'),
    asyncHandler(mediaController.remove));

// ─── Playlists ───────────────────────────────────────────────────────────────

router.get('/playlists',
    authMiddleware, requireMeippViewer(),
    asyncHandler(playlistController.list));

router.get('/playlists/:id',
    authMiddleware, requireMeippViewer(),
    asyncHandler(playlistController.getById));

router.post('/playlists',
    authMiddleware, requireMeippEditor(),
    validate(postPlaylistSchema), audit('playlist'),
    asyncHandler(playlistController.create));

router.put('/playlists/:id',
    authMiddleware, requireMeippEditor(),
    validate(putPlaylistSchema), audit('playlist'),
    asyncHandler(playlistController.update));

router.delete('/playlists/:id',
    authMiddleware, requireMeippEditor(),
    audit('playlist'),
    asyncHandler(playlistController.remove));

router.get('/playlists/:id/items',
    authMiddleware, requireMeippViewer(),
    asyncHandler(playlistController.listItems));

/**
 * @route PATCH /meipp/playlists/:id/items/reorder
 * @description Grava a ordem completa dos itens. Body: `{ item_ids: [...] }`.
 *
 * Declarada ANTES de `/playlists/:id/items/:itemId`: sem isso, `reorder` casaria
 * como `:itemId` e a reordenação viraria um update de item inexistente.
 * @access editor
 */
router.patch('/playlists/:id/items/reorder',
    authMiddleware, requireMeippEditor(),
    audit('playlist', { action: 'reorder_items' }),
    asyncHandler(playlistController.reorderItems));

router.post('/playlists/:id/items',
    authMiddleware, requireMeippEditor(),
    validate(postPlaylistItemSchema), audit('playlist_item'),
    asyncHandler(playlistController.addItem));

router.put('/playlists/:id/items/:itemId',
    authMiddleware, requireMeippEditor(),
    validate(putPlaylistItemSchema), audit('playlist_item'),
    asyncHandler(playlistController.updateItem));

router.delete('/playlists/:id/items/:itemId',
    authMiddleware, requireMeippEditor(),
    audit('playlist_item'),
    asyncHandler(playlistController.removeItem));

// ─── Agendamentos ────────────────────────────────────────────────────────────

router.get('/schedules',
    authMiddleware, requireMeippViewer(),
    asyncHandler(scheduleController.list));

router.get('/schedules/:id',
    authMiddleware, requireMeippViewer(),
    asyncHandler(scheduleController.getById));

router.post('/schedules',
    authMiddleware, requireMeippEditor(),
    validate(postScheduleSchema), audit('schedule'),
    asyncHandler(scheduleController.create));

router.put('/schedules/:id',
    authMiddleware, requireMeippEditor(),
    validate(putScheduleSchema), audit('schedule'),
    asyncHandler(scheduleController.update));

router.delete('/schedules/:id',
    authMiddleware, requireMeippEditor(),
    audit('schedule'),
    asyncHandler(scheduleController.remove));

router.get('/schedules/:id/targets',
    authMiddleware, requireMeippViewer(),
    asyncHandler(scheduleController.listTargets));

router.post('/schedules/:id/targets',
    authMiddleware, requireMeippEditor(),
    validate(postScheduleTargetSchema), audit('schedule_target'),
    asyncHandler(scheduleController.addTarget));

router.delete('/schedules/:id/targets/:targetId',
    authMiddleware, requireMeippEditor(),
    audit('schedule_target'),
    asyncHandler(scheduleController.removeTarget));

// ─── Auditoria (somente admin) ───────────────────────────────────────────────

/**
 * @route GET /meipp/audit-log?entity_type=player&user_id=3&page=1&limit=50
 * @description Trilha de auditoria, paginada e filtrável.
 * @access admin
 */
router.get('/audit-log',
    authMiddleware, requireMeippAdmin(),
    asyncHandler(auditController.list));

module.exports = router;
