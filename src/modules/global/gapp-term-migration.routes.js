/**
 * @fileoverview Roteador TEMPORÁRIO da migração de termos de smartphone do
 * sistema legado (arquivos `<codigo>-<nome>.<ext>` + `GIPP.gs_smartphone`).
 *
 * Montado pelo `routes.js` do global sob `/gapp/term-migration`. Isolado para
 * sair inteiro quando a migração acabar: apagar o `router.use` de lá, este
 * arquivo e os demais `*term-migration*` (lista em `docs/gapp-migracao-termos.md`).
 *
 * Só `SYSTEM_OWNER` (`canAll` libera o dono do sistema por bypass e ninguém
 * mais tem esse código).
 *
 * | Ação da tela                         | Rota                                         |
 * |--------------------------------------|----------------------------------------------|
 * | painel (contagens)                   | `GET   /gapp/term-migration/summary`         |
 * | listagem                             | `GET   /gapp/term-migration`                 |
 * | detalhe + trilha                     | `GET   /gapp/term-migration/:id`             |
 * | identificar arquivos da pasta        | `POST  /gapp/term-migration/scan`            |
 * | validar vínculos (legado → IMEI)     | `POST  /gapp/term-migration/validate`        |
 * | migrar validados (lote)              | `POST  /gapp/term-migration/migrate`         |
 * | reprocessar erros / não localizados  | `POST  /gapp/term-migration/retry`           |
 * | ignorar / devolver para a fila       | `PATCH /gapp/term-migration/:id/ignore|restore` |
 *
 * @module modules/global/gapp-term-migration.routes
 */

const express = require('express');

const router = express.Router();

const controller = require('./controllers/gapp-term-migration.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const { asyncHandler } = require('../../middlewares/async-handler.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const { canAll } = require('../../middlewares/permission.middleware');
const {
    listTermMigrationQuerySchema, batchSchema, ignoreSchema, validateIdList,
} = require('../../schemas/gapp-term-migration.schema');

const guard = [authMiddleware, canAll(['SYSTEM_OWNER'])];

/**
 * @route GET /gapp/term-migration/summary
 * @description Total identificado e contagem por status e por motivo; diz se a
 * pasta de origem está configurada.
 */
router.get('/summary', ...guard, asyncHandler(controller.summary));

/**
 * @route GET /gapp/term-migration
 * @description Listagem paginada (`{ items, pagination }`). Filtros: status,
 * issue_code, active_id_fk, search (nome do arquivo, IMEI ou código antigo).
 */
router.get('/', ...guard, validate(listTermMigrationQuerySchema, 'query'), asyncHandler(controller.list));

/**
 * @route POST /gapp/term-migration/scan
 * @description Varre a pasta de origem e registra os arquivos novos como
 * `pending`. Idempotente: arquivo já registrado não é tocado.
 */
router.post('/scan', ...guard, asyncHandler(controller.scan));

/**
 * @route POST /gapp/term-migration/validate
 * @description Resolve código antigo → IMEI → smartphone da base nova. Sem
 * `ids`: os próximos `pending` (`limit`, padrão 200). Não grava termo nenhum.
 */
router.post('/validate', ...guard, validate(batchSchema), validateIdList, asyncHandler(controller.validate));

/**
 * @route POST /gapp/term-migration/migrate
 * @description Migra os `validated` pelo cadastro de termos de sempre
 * (FileService + gapp_asset_term). Sem `ids`: os próximos (`limit`, padrão 10,
 * teto 50).
 */
router.post('/migrate', ...guard, validate(batchSchema), validateIdList, asyncHandler(controller.migrate));

/**
 * @route POST /gapp/term-migration/retry
 * @description Devolve `error`, `not_found` e `processing` abandonado para a
 * fila e valida de novo. Nunca migra direto.
 */
router.post('/retry', ...guard, validate(batchSchema), validateIdList, asyncHandler(controller.retry));

/** @route GET /gapp/term-migration/:id */
router.get('/:id', ...guard, asyncHandler(controller.getById));

/**
 * @route PATCH /gapp/term-migration/:id/ignore
 * @description Tira o arquivo da migração (análise manual). Só o que ainda não
 * foi migrado.
 */
router.patch('/:id/ignore', ...guard, validate(ignoreSchema), asyncHandler(controller.ignore));

/** @route PATCH /gapp/term-migration/:id/restore — ignorado volta para `pending`. */
router.patch('/:id/restore', ...guard, asyncHandler(controller.restore));

module.exports = router;
