/**
 * @fileoverview Rotas do controle de refeitório.
 *
 * Montado em **`/gipp/meal`** pelo app interno. O prefixo não é o nome do
 * módulo: no Apache do 10.10.10.99 as regras de proxy são por FONTE DE DADOS —
 * `/global` para o MySQL, `/gipp` para o SQL Server GIPP, `/protheus` para o
 * Protheus. Como o refeitório lê `GIPP.dbo`, ele entra sob `/gipp` e herda a
 * regra que já existe, em vez de exigir uma nova a cada módulo.
 *
 * Só o app interno — o operador usa aparelho da empresa, na rede da empresa. O
 * único endpoint que um dia sairá para a internet é o autocadastro facial por
 * link (etapa 6), e ele vive no app público, com par de segredos JWT separado.
 *
 * URL completa vista pelo cliente: `https://gigpp.com.br:73/api/v1/gipp/meal/...`
 *
 * @module modules/meal/routes
 */

const express = require('express');
const router = express.Router();
const authMiddleware = require('../../middlewares/auth.middleware');
const { canAny } = require('../../middlewares/permission.middleware');
const { asyncHandler } = require('../../middlewares/async-handler.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const {
    postMealLogSchema,
    postDinerGroupSchema,
    postCouponValidateSchema,
    postCouponRedeemSchema,
} = require('../../schemas/meal.schema');
const { faceUpload } = require('./infrastructure/face-upload.middleware');
const mealController = require('./controllers/meal.controller');
const enrollController = require('./controllers/meal-enroll.controller');
const couponController = require('./controllers/meal-coupon.controller');

/** Quem serve a refeição. Também é quem lê a lista e os botões. */
const CAN_SERVE = ['MEAL_SERVE', 'MEAL_MANAGE'];

/** Quem cadastra os baldes — RH, não o operador. */
const CAN_MANAGE_GROUPS = ['MEAL_MANAGE_GROUPS', 'MEAL_MANAGE'];

/**
 * Quem lê relatório. Separado de MEAL_SERVE de propósito: o operador registra
 * refeição e não precisa ver o consolidado por centro de custo da empresa.
 */
const CAN_VIEW_REPORT = ['MEAL_VIEW_REPORT', 'MEAL_MANAGE'];

// ─── Sessão do operador ───────────────────────────────────────────────────────

/** Confere a loja escolhida na sessão antes de servir a primeira refeição. */
router.get('/sites/:siteCode',
    authMiddleware,
    canAny(CAN_SERVE),
    asyncHandler(mealController.getSite));

// ─── Comensais ────────────────────────────────────────────────────────────────

// A rota de lista vem ANTES da rota de item por engano frequente de ordem em
// Express — aqui não há ambiguidade porque os caminhos têm profundidade
// diferente, mas manter a ordem evita a pegadinha se alguém acrescentar
// `/diners/:algo` depois.
router.get('/diners',
    authMiddleware,
    canAny(CAN_SERVE),
    asyncHandler(mealController.getDiners));

/** A chave tem três partes: a matrícula só é única dentro de uma empresa. */
router.get('/diners/:companyCode/:branchCode/:employeeId',
    authMiddleware,
    canAny(CAN_SERVE),
    asyncHandler(mealController.getDiner));

// ─── Baldes (grupos sem matrícula) ────────────────────────────────────────────

router.get('/diner-groups',
    authMiddleware,
    canAny([...CAN_SERVE, ...CAN_MANAGE_GROUPS]),
    asyncHandler(mealController.getDinerGroups));

router.post('/diner-groups',
    authMiddleware,
    canAny(CAN_MANAGE_GROUPS),
    validate(postDinerGroupSchema),
    asyncHandler(mealController.postDinerGroup));

// Não existe DELETE de propósito: desativar é `is_active = 0`. A FK é
// NO_ACTION, e um grupo com refeição registrada não pode desaparecer sem levar
// o histórico de custo com ele.
router.patch('/diner-groups/:id',
    authMiddleware,
    canAny(CAN_MANAGE_GROUPS),
    asyncHandler(mealController.patchDinerGroup));

// ─── Relatórios ───────────────────────────────────────────────────────────────
//
// Todos exigem recorte de datas (`date_from` e `date_to`), limitado a 92 dias.
// Não é preferência: `IX_meal_log_rpt` tem `service_date` como primeira coluna
// da chave, então a consulta com recorte é seek e a sem recorte é varredura da
// tabela inteira.

router.get('/reports/daily',
    authMiddleware,
    canAny(CAN_VIEW_REPORT),
    asyncHandler(mealController.getDailyReport));

router.get('/reports/cost-center',
    authMiddleware,
    canAny(CAN_VIEW_REPORT),
    asyncHandler(mealController.getCostCenterReport));

router.get('/reports/payee',
    authMiddleware,
    canAny(CAN_VIEW_REPORT),
    asyncHandler(mealController.getPayeeReport));

router.get('/reports/exceptions',
    authMiddleware,
    canAny(CAN_VIEW_REPORT),
    asyncHandler(mealController.getExceptionsReport));

// ─── Autocadastro facial (etapa 6) ────────────────────────────────────────────
//
// ⚠️ Três rotas aqui NÃO têm authMiddleware, e isso é o desenho, não descuido.
//   Quem se autocadastra é o colaborador, do celular dele, e a maioria de quem
//   come no refeitório NÃO TEM LOGIN — foi essa constatação que fez a fonte de
//   colaborador ser o SRA020 e não o `_user`. Exigir sessão aqui excluiria
//   justamente o público do módulo.
//
//   A credencial dessas rotas é o TOKEN ASSINADO INDIVIDUAL, não o cookie. Sem
//   token válido não há resposta nenhuma — nem a informação de que a matrícula
//   existe. Ver `_loadOpenToken` e o comentário sobre o oráculo em
//   meal-enroll.use-cases.js.
//
//   Como a autenticação é o token e não a sessão, este bloco funciona igual
//   montado no app público — mover é trocar o prefixo, não reescrever.

/**
 * Cadastro presencial, no aparelho do operador — sem link, sem navegador.
 *
 * A pessoa está na frente do balcão, o crachá já a identificou, e ela mesma
 * aceita o termo na tela. Prova de identidade mais forte que a do link, por isso
 * grava `enroll_verified_by = 2` em vez de 1.
 */
router.post('/enroll/direct',
    authMiddleware,
    canAny(CAN_SERVE),
    faceUpload.array('images', 5),
    asyncHandler(enrollController.postDirectEnroll));

/** Emitir convite é ato do RH, e exige sessão. */
router.post('/enroll/invites',
    authMiddleware,
    canAny(CAN_MANAGE_GROUPS),
    asyncHandler(enrollController.postInvite));

/** A tela do operador usa para esconder o modo facial quando o serviço cai. */
router.get('/enroll/health',
    authMiddleware,
    canAny(CAN_SERVE),
    asyncHandler(enrollController.getFaceHealth));

/**
 * Comparação 1:1. Não registra refeição — só confere o rosto.
 *
 * `upload.single` porque o app manda multipart: o `capture()` da camera-kit
 * devolve URI de arquivo, e o `FormData` do React Native monta a parte sem ler o
 * conteúdo para a memória do JS. O multer da casa usa `memoryStorage()`, então
 * nada toca disco de nenhum dos dois lados. Base64 em JSON também é aceito, para
 * o navegador.
 */
router.post('/enroll/verify',
    authMiddleware,
    canAny(CAN_SERVE),
    faceUpload.single('image'),
    asyncHandler(enrollController.postVerify));

/**
 * Identificação 1:N — rosto sozinho, sem crachá.
 *
 * Duas travas fazem isto ser defensável: a busca é restrita à loja (~164 pessoas
 * em vez de 1.700) e o primeiro colocado tem que estar à frente do segundo por uma
 * margem. Empate devolve `ambiguous` e a tela pede o crachá — o erro a evitar não
 * é "não reconheceu", é o sistema afirmar que alguém é outra pessoa.
 */
router.post('/enroll/identify',
    authMiddleware,
    canAny(CAN_SERVE),
    faceUpload.single('image'),
    asyncHandler(enrollController.postIdentify));

router.get('/enroll/status/:company/:branch/:employee',
    authMiddleware,
    canAny([...CAN_SERVE, ...CAN_MANAGE_GROUPS]),
    asyncHandler(enrollController.getStatus));

/** Revogação. Direito de eliminação — não pede justificativa. */
router.delete('/enroll/status/:company/:branch/:employee',
    authMiddleware,
    canAny([...CAN_SERVE, ...CAN_MANAGE_GROUPS]),
    asyncHandler(enrollController.deleteEnrollment));

// ─── Sem sessão: o colaborador, no celular dele ───────────────────────────────
//
// A ordem aqui é invariante, não estilo. O Express resolve na ordem de registro e
// um parâmetro casa qualquer coisa: `/enroll/:token` engoliria `/enroll/health`,
// `/enroll/verify` e `/enroll/complete` se viesse antes deles. Por isso TODA rota
// de caminho literal fica acima das que têm `:token` — inclusive as sem sessão.

/**
 * O token de conferência vai no CORPO: URL vaza para log de acesso e histórico.
 *
 * `faceUpload.array('images', 5)` — o limite bate com MAX_IMAGES do caso de uso. Se
 * divergir, o multer descarta silenciosamente e o cadastro reclama de "envie de 3
 * a 5 capturas" para quem enviou 5.
 */
router.post('/enroll/complete',
    faceUpload.array('images', 5),
    asyncHandler(enrollController.postComplete));

router.get('/enroll/:token',
    asyncHandler(enrollController.getInvite));

router.post('/enroll/:token/confirm',
    asyncHandler(enrollController.postConfirm));

// ─── Cupom fiscal: almoço vendido a prestador de serviço ──────────────────────
//
// O prestador compra o almoço no caixa e o cupom da compra libera a refeição no
// balcão. Quatro travas, nesta ordem de custo: a chave confere consigo mesma
// (dígito verificador, local), o CNPJ é de uma loja do grupo que vende almoço e
// é ESTA loja, a venda existe no Consinco e é de hoje com o produto travado, e o
// cupom ainda tem saldo.
//
// ⚠️ Este bloco NÃO funciona offline, e é o único do módulo que não funciona.
//   Validar exige o Consinco e o saldo, e nenhum dos dois tem resposta local.
//   Enfileirar significaria servir sem saber — e a fila é exatamente onde o
//   mesmo cupom passa duas vezes. Quando a rede cai, o modo cupom some da tela,
//   como o modo facial some quando o container de reconhecimento morre.

/** Confere e mostra quantos almoços o cupom libera. Não consome. */
router.post('/coupons/validate',
    authMiddleware,
    canAny(CAN_SERVE),
    validate(postCouponValidateSchema),
    asyncHandler(couponController.postValidateCoupon));

/**
 * Debita uma refeição do cupom e registra a refeição, numa transação só.
 *
 * Rota própria em vez de `/logs` com `diner_type = 3`: o resgate precisa de
 * transação, e manter o cupom fora do `/logs` é o que impede, estruturalmente,
 * que ele entre na fila de `/logs/sync`.
 */
router.post('/coupons/redeem',
    authMiddleware,
    canAny(CAN_SERVE),
    validate(postCouponRedeemSchema),
    asyncHandler(couponController.postRedeemCoupon));

// ─── Registro de refeição ─────────────────────────────────────────────────────

router.post('/logs',
    authMiddleware,
    canAny(CAN_SERVE),
    validate(postMealLogSchema),
    asyncHandler(mealController.postMealLog));

// Sem `validate` de envelope: o lote é validado item a item no caso de uso, para
// que um registro inválido não derrube os outros vinte e nove.
router.post('/logs/sync',
    authMiddleware,
    canAny(CAN_SERVE),
    asyncHandler(mealController.postMealLogSync));

module.exports = router;
