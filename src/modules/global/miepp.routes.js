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
const productGridController = require('./controllers/miepp-product-grid.controller');
const playlistController = require('./controllers/miepp-playlist.controller');
const scheduleController = require('./controllers/miepp-schedule.controller');
const deviceController = require('./controllers/miepp-device.controller');
const playController = require('./controllers/miepp-play.controller');
const auditController = require('./controllers/miepp-audit.controller');

const authMiddleware = require('../../middlewares/auth.middleware');
const { asyncHandler } = require('../../middlewares/async-handler.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const { audit } = require('../../middlewares/miepp-audit.middleware');
const { authenticateDevice } = require('../../middlewares/miepp-device-auth.middleware');
const { deviceLimiter, pairLimiter } = require('../../middlewares/rate-limit.middleware');
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
    postProductGridSchema, putProductGridSchema,
    postPlaylistSchema, putPlaylistSchema, postPlaylistItemSchema, putPlaylistItemSchema,
    postScheduleSchema, putScheduleSchema, postScheduleTargetSchema,
    postPairSchema, postHeartbeatSchema, postCommandAckSchema,
} = require('../../schemas/miepp.schema');

// A busca de produto da grade é a MESMA consulta do BPPP, então reusa o schema
// do BPPP — duplicá-lo faria as duas divergirem na primeira mudança.
const { searchProductQuerySchema } = require('../../schemas/bppp.schema');

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
 * @description Troca o código de pareamento (8 dígitos) pelo token do
 * dispositivo. O token é devolvido em texto puro UMA única vez — o banco guarda
 * só o SHA-256. O código é de uso único e some ao ser consumido.
 *
 * Sob `pairLimiter` (10 tentativas por IP / 15 min), e não sob o `deviceLimiter`:
 * é o que impede varredura do espaço de 8 dígitos.
 * @access Público (autorizado pelo próprio código de pareamento)
 */
router.post('/device/pair',
    pairLimiter,
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
 * @route POST /miepp/device/plays
 * @description Registra as exibições que a tela já fez (proof-of-play). Corpo:
 * `{ plays: [{ event_uuid, media_uuid, started_at, duration_ms, completed,
 * playlist_id, schedule_id }] }`, no máximo 200 por requisição.
 *
 * É a ÚNICA rota em que o dispositivo escreve conteúdo. Ela existe porque nada
 * no servidor sabe o que apareceu na parede: o heartbeat só reporta saúde da
 * máquina, e a entrega do binário não conta exibição (o player cacheia por
 * checksum, então mídia que toca 400 vezes é baixada uma).
 *
 * Idempotente por `event_uuid`, e a chave é gerada NO DISPOSITIVO — é o que
 * permite ao app enfileirar offline e reenviar sem dobrar a contagem.
 *
 * Sem `validate(...)` de propósito: o corpo é inteiramente um array de objetos,
 * que o formato do `validate.middleware` não expressa, e a crítica precisa ser
 * por evento e não pelo lote (um evento ruim não pode travar a fila da tela).
 * Quem valida é `domain/miepp/play/play-event.rules`.
 * @access Token de dispositivo
 */
router.post('/device/plays',
    deviceLimiter,
    authenticateDevice,
    asyncHandler(deviceController.recordPlays));

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

/**
 * @route GET /miepp/players/:id/plays?from=2026-09-20&to=2026-09-21&media_id=5
 * @description Exibições CRUAS desta tela, uma linha por mídia que apareceu na
 * parede. É a evidência de "o que essa tela tocou às 14h03".
 *
 * Lê o evento cru, que tem retenção de ~90 dias — para histórico longo use
 * `GET /miepp/reports/media-plays`, que lê o acumulado. Uma janela anterior à
 * purga volta vazia sem erro.
 *
 * `CAN_READ` como o `status-log` ao lado: é dado operacional da tela, não
 * auditoria de pessoa.
 * @access viewer
 */
router.get('/players/:id/plays',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(playController.listPlayerPlays));

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

/**
 * @route GET /miepp/media?type=image&status=ready&origin=upload
 * @description Biblioteca de mídia. Cada linha sai com `origin`
 * (`upload` | `generated`) e `grid_id`: a grade de produtos é uma mídia
 * `image` como qualquer outra, e sem esses dois campos o painel não tem como
 * separar uma grade de um arquivo enviado à mão — nem como levar quem clica ao
 * editor da grade, que é onde se mexe nos produtos.
 *
 * `?origin=` filtra no banco, com a contagem usando o mesmo `WHERE`; filtrar a
 * página já recebida devolveria páginas incompletas.
 * @access viewer
 */
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

/**
 * @route GET /miepp/media/:id/plays?from=2026-09-01&to=2026-09-21
 * @description Quantas vezes esta mídia foi exibida no período, aberta por
 * LOCAL, por TELA e por DIA — as três quebras na mesma resposta.
 *
 * Vêm juntas de propósito: quem abre essa tela quer as três ao mesmo tempo, e
 * três rotas com `?group_by=` dariam três oportunidades de a janela de datas
 * divergir entre os painéis.
 *
 * Mídia já apagada continua respondendo, pelo snapshot de título gravado em
 * cada exibição (`media.exists: false` na resposta) — o DELETE de mídia é
 * físico, e o relatório de uma campanha encerrada é justamente o que se
 * consulta depois.
 * @access viewer
 */
router.get('/media/:id/plays',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(playController.mediaPlayReport));

router.delete('/media/:id',
    authMiddleware, canAny(CAN_WRITE),
    audit('media'),
    asyncHandler(mediaController.remove));

// ─── Grade de produtos ───────────────────────────────────────────────────────
//
// A grade é uma mídia `image` com curadoria por trás: `miepp_product_grids`
// guarda os PLUs, a loja e o fundo, e o servidor renderiza a imagem lendo
// descrição e preço do Consinco. O player não sabe que a grade existe — ela
// entra em playlist e agendamento como qualquer imagem.
//
// Não há permissão nova: montar grade é editar conteúdo (`CAN_WRITE`). Só a
// trilha de renders e o render forçado exigem `CAN_ADMINISTER`, na mesma linha
// da auditoria e da revogação de token.

/**
 * @route GET /miepp/product-search
 * @description Busca produto no Consinco para montar a grade. `shop_id` +
 * exatamente UM de `plu` | `ean` | `description`. Mesma resposta de
 * `GET /bppp/products` — é o mesmo caso de uso, atrás da permissão do miepp.
 *
 * Declarada ANTES de `/product-grids/...` por clareza; não há conflito de
 * prefixo entre as duas.
 * @access editor
 */
router.get('/product-search',
    authMiddleware, canAny(CAN_WRITE),
    validate(searchProductQuerySchema, 'query'),
    asyncHandler(productGridController.searchProducts));

router.get('/product-grids',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(productGridController.list));

router.get('/product-grids/:id',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(productGridController.getById));

/**
 * @route POST /miepp/product-grids
 * @description Cria a grade e a mídia que ela alimenta. O corpo é JSON: os
 * itens vêm em `items: [{ plu, order_index, label_override }]`. Enviar
 * descrição, preço ou EAN no item é recusado com 400 — a grade guarda o PLU, e
 * o dado do produto é lido do Consinco no render.
 *
 * A imagem de fundo sobe depois, em `POST /product-grids/:id/background`.
 * @access editor
 */
router.post('/product-grids',
    authMiddleware, canAny(CAN_WRITE),
    validate(postProductGridSchema), audit('product_grid'),
    asyncHandler(productGridController.create));

router.put('/product-grids/:id',
    authMiddleware, canAny(CAN_WRITE),
    validate(putProductGridSchema), audit('product_grid'),
    asyncHandler(productGridController.update));

/**
 * @route POST /miepp/product-grids/:id/background
 * @description Envia a imagem de fundo (campo `file`, multipart). Só
 * `image/*` — o `FileService` aceitaria PDF e planilha, que só falhariam
 * dentro do renderizador.
 * @access editor
 */
router.post('/product-grids/:id/background',
    authMiddleware, canAny(CAN_WRITE),
    fileUpload.single('file'),
    audit('product_grid', { action: 'background' }),
    asyncHandler(productGridController.uploadBackground));

/**
 * @route POST /miepp/product-grids/:id/render
 * @description Marca a grade para renderizar no próximo ciclo (zera o
 * `data_hash`).
 *
 * ⚠️ NÃO gera imagem aqui: quem desenha é o worker `miepp-grid-renderer`, no
 * próximo ciclo. Esta rota é `CAN_ADMINISTER` e ainda assim NÃO é o caminho
 * normal até a imagem — o PUT da grade já zera o `data_hash`, então editor com
 * `MIEPP_EDIT` muda item, layout ou estilo e a grade redesenha sozinha. O que
 * se compra aqui é prioridade na fila. Ver `docs/miepp.md`.
 * @access admin
 */
router.post('/product-grids/:id/render',
    authMiddleware, canAny(CAN_ADMINISTER),
    audit('product_grid', { action: 'render' }),
    asyncHandler(productGridController.requestRender));

router.delete('/product-grids/:id',
    authMiddleware, canAny(CAN_WRITE),
    audit('product_grid'),
    asyncHandler(productGridController.remove));

/**
 * @route GET /miepp/product-grids/:id/renders
 * @description Trilha do que a tela exibiu: uma linha por render efetivo, com o
 * `snapshot` dos produtos e preços daquele momento. É a resposta para uma
 * reclamação de preço. Somente leitura — nenhuma rota escreve nesta tabela.
 * @access admin
 */
router.get('/product-grids/:id/renders',
    authMiddleware, canAny(CAN_ADMINISTER),
    asyncHandler(productGridController.listRenders));

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

// ─── Relatórios de exibição (proof-of-play) ──────────────────────────────────
//
// Leem o ACUMULADO (`miepp_media_play_daily`), não o evento cru: o cru tem
// retenção curta, e relatório construído sobre ele passaria a mentir no dia da
// primeira purga. Ver `miepp-play-log.sql`.
//
// Sem permissão nova — relatório é leitura do módulo (`CAN_READ`), na mesma
// linha da decisão tomada na grade de produtos.

/**
 * @route GET /miepp/reports/media-plays?from=2026-09-01&to=2026-09-21&location_id=3&player_id=8&media_id=5
 * @description Ranking do período: uma linha por mídia, da mais exibida para a
 * menos, com total de exibições, quantas terminaram, tempo somado em tela e em
 * quantas telas e locais ela passou.
 *
 * Os filtros são o recorte da mesma pergunta: com `location_id`, a contagem é
 * só do que aquele local exibiu; com `player_id`, só daquela tela.
 *
 * Janela padrão de 30 dias, teto de 366 — a janela efetivamente usada volta em
 * `range`, então o encurtamento nunca é silencioso.
 * @access viewer
 */
router.get('/reports/media-plays',
    authMiddleware, canAny(CAN_READ),
    asyncHandler(playController.listMediaPlays));

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
