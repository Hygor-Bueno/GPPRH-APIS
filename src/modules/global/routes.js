/**
 * @fileoverview Roteador global da API GIPP-RH.
 *
 * Define todas as rotas públicas e autenticadas do módulo global, incluindo:
 * - Autenticação (login, logout, /me)
 * - Foto de colaboradores
 * - Compensações e beneficiários GIPP-RH
 * - Colaboradores paginados e códigos de evento
 * - Recibos de pagamento (CRUD + geração de PDF)
 * - Prestadores (payees)
 * - Gestão de acessos (usuários, papéis, permissões, aplicações)
 * - Chat direto (mensagens, conversas, upload de arquivos)
 *
 * Cada rota protegida passa por `authMiddleware` (verificação de JWT) e
 * pelo middleware de permissão (`canAll` / `canAny`) antes de chegar ao controller.
 *
 * @module modules/global/routes
 */

const express = require('express');
const router = express.Router();
const authController = require('./controllers/auth.controller');
const employeeController = require('./controllers/employee.controller');
const gippRhController = require('./controllers/gipp-rh.controller');
const payeeController = require('./controllers/payee.controller');
const accessController = require('./controllers/access.controller');
const chatController = require('./controllers/chat.controller');
const filesController = require('./controllers/files.controller');
const gtppTaskController = require('./controllers/gtpp-task.controller');
const gtppItemController = require('./controllers/gtpp-task-item.controller');
const gtppResponseController = require('./controllers/gtpp-task-item-response.controller');
const gtppTaskUserController = require('./controllers/gtpp-task-user.controller');
const gtppScopeController = require('./controllers/gtpp-task-scope.controller');
const gtppMessageController = require('./controllers/gtpp-message.controller');
const gtppNotifyController = require('./controllers/gtpp-notify.controller');
const gtppThemeController = require('./controllers/gtpp-theme.controller');
const gtppScoreController = require('./controllers/gtpp-score.controller');
const eppProductController = require('./controllers/epp-product.controller');
const eppMenuController = require('./controllers/epp-menu.controller');
const eppOrderController = require('./controllers/epp-order.controller');
const eppLogSaleController = require('./controllers/epp-log-sale.controller');
const eppStockController = require('./controllers/epp-stock.controller');
const bpppProductController = require('./controllers/bppp-product.controller');
const shopController = require('./controllers/shop.controller');
const gappActiveController = require('./controllers/gapp-active.controller');
const gappInsuranceController = require('./controllers/gapp-insurance.controller');
const gappVehicleController = require('./controllers/gapp-vehicle.controller');
const gappLookupController = require('./controllers/gapp-lookup.controller');
const gappExpensesController = require('./controllers/gapp-expenses.controller');
const gappNfController = require('./controllers/gapp-nf.controller');
const gappInfractionsController = require('./controllers/gapp-infractions.controller');
const gappMovimentationController = require('./controllers/gapp-movimentation.controller');
const gappStoreController = require('./controllers/gapp-store.controller');
const gappSettingsController = require('./controllers/gapp-settings.controller');
const mieppRoutes = require('./miepp.routes');
const { upload: fileUpload } = require('../../utils/file/file.service');
const authMiddleware = require('../../middlewares/auth.middleware');
const upload = require('../../middlewares/upload.middleware');
const { canAll, canAny } = require('../../middlewares/permission.middleware');
const { asyncHandler } = require('../../middlewares/async-handler.middleware');
const { loginLimiter, loginIpLimiter, changePasswordLimiter } = require('../../middlewares/rate-limit.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const { loginSchema, changePasswordSchema } = require('../../schemas/auth.schema');
const {
    postCompensationSchema,
    putCompensationSchema,
    postBeneficiarySchema,
    putBeneficiarySchema,
    getReceiptQuerySchema,
    postPaymentReceiptSchema,
    putPaymentReceiptSchema,
    patchPaymentReceiptSchema
} = require('../../schemas/gipp-rh.schema');
const { postPayeeSchema, putPayeeSchema, patchPayeeSchema } = require('../../schemas/payee.schema');
const { searchProductQuerySchema, listByDepartmentQuerySchema } = require('../../schemas/bppp.schema');
const { sendMessageSchema, markAsReadSchema } = require('../../schemas/chat.schema');
const {
    postProductSchema, putProductSchema, patchProductStatusSchema,
    postMenuSchema, putMenuSchema,
    postLogMenuSchema, putLogMenuSchema,
    postOrderSchema, postOrderBulkSchema, putOrderSchema, patchOrderStatusSchema,
    postLogSaleSchema, putLogSaleSchema,
    postStockSchema, putStockSchema,
    postEcommerceOrderSchema,
} = require('../../schemas/epp.schema');
const {
    createActiveSchema, updateActiveSchema, validateVehicleAndInsurancePayload,
    createInsuranceSchema, updateInsuranceSchema,
    listActiveQuerySchema, listVehicleQuerySchema, listInsuranceQuerySchema,
    createExpenseSchema, updateExpenseSchema,
    listExpensesQuerySchema, listVehicleExpensesQuerySchema,
    validateExpenseTypePayload,
    createStoreSchema, updateStoreSchema, listStoreQuerySchema,
    createNfSchema,
    updateNfSchema
} = require('../../schemas/gapp.schema');
const {
    postTaskSchema, putTaskStateSchema, putTaskTitleSchema, putTaskDescriptionSchema, putTaskThemeSchema,
    postTaskItemSchema, putTaskItemSchema,
    putTaskItemResponseSchema,
    putTaskUserSchema,
    postTaskScopeSchema,
    postTaskMessageSchema,
    postThemeSchema, putThemeSchema,
    disqualifyQuerySchema,
} = require('../../schemas/gtpp.schema');
const {
    postUserSchema,
    putUserSchema,
    patchUserSchema,
    postRoleSchema,
    putRoleSchema,
    postPermissionSchema,
    putPermissionSchema,
    assignRolesSchema,
    assignPermissionsSchema,
    setPermissionsSchema,
    grantApplicationSchema
} = require('../../schemas/access.schema');

// ─── Rotas Públicas ───────────────────────────────────────────────────────────

/**
 * @route GET /me
 * @description Retorna os dados do usuário autenticado a partir do token JWT.
 * @access Autenticado
 */
router.get('/me', authMiddleware, asyncHandler(authController.me));

/**
 * @route POST /logout
 * @description Encerra a sessão do usuário (invalida o token/cookie).
 * @access Público
 */
router.post('/logout', asyncHandler(authController.logout));

/**
 * @route POST /login
 * @description Autentica o usuário com matrícula e senha.
 * Aplica rate limiting (`loginLimiter`) e validação de schema.
 * @access Público
 */
// Dois limiters no login, com papéis distintos: `loginLimiter` conta falhas
// por IP+usuário (senha errada de um não trava os colegas do mesmo IP) e
// `loginIpLimiter` põe um teto por IP, para que trocar de conta a cada 10
// tentativas não vire brecha.
router.post('/login', loginIpLimiter, loginLimiter, validate(loginSchema), asyncHandler(authController.globalLogin));

/**
 * @route PUT /change-password
 * @description Troca a senha do próprio usuário autenticado.
 * Body: `{ current_password, new_password }` — o id vem do token, nunca do body.
 *
 * ⚠️ Só vale para usuário LOCAL. Usuário de AD recebe 400 com orientação para
 * trocar pelo Windows: a senha no banco é espelho do AD e é sobrescrita a cada
 * login, então gravar aqui não teria efeito nenhum.
 *
 * Em caso de sucesso os cookies são limpos e o usuário precisa entrar de novo.
 * @access Autenticado (sem permissão específica)
 */
router.put('/change-password',
    authMiddleware,
    changePasswordLimiter,
    validate(changePasswordSchema),
    asyncHandler(authController.changePassword));

// ─── Colaboradores ────────────────────────────────────────────────────────────

/**
 * @route GET /employees
 * @description Lista colaboradores paginados com filtros opcionais.
 * Query params: pPage, pPageSize, pEmployeeName, pCompanyId, pShopId,
 *   pDepartmentId, pSubDepartmentId, pApplicationAccess.
 * @access Requer `CORE_VIEW_EMPLOYEE`
 */
router.get('/employees',
    authMiddleware,
    canAll(['CORE_VIEW_EMPLOYEE']),
    asyncHandler(employeeController.getEmployees));

/**
 * @route GET /users
 * @description Lista usuários paginados com enriquecimento do Protheus (empresa, filial, CC).
 * Query params: pPage, pPageSize, pName, pApplicationId, pStatus.
 * @access Requer `CORE_VIEW_EMPLOYEE`
 */
router.get('/users',
    authMiddleware,
    canAll(['CORE_VIEW_EMPLOYEE']),
    asyncHandler(employeeController.getUsers));

// ─── Foto do Colaborador ──────────────────────────────────────────────────────

/**
 * @route POST /employee/:id/photo
 * @description Faz upload da foto de um colaborador.
 * @access Autenticado (sem permissão específica)
 */
router.post('/employee/:id/photo',
    authMiddleware,
    upload.single("photo"),
    asyncHandler(employeeController.postPhotoEmployee));

/**
 * @route GET /employee/:id/photo
 * @description Retorna a foto de um colaborador.
 * @access Público
 */
router.get('/employee/:id/photo', asyncHandler(employeeController.getPhotoEmployee));

// ─── Compensações ─────────────────────────────────────────────────────────────

/**
 * @route GET /gipp-rh/active-compensations
 * @description Lista todas as compensações ativas.
 * @access Requer `GIPPRH_VIEW_BENEFIT` ou `GIPPRH_MANAGE_BENEFIT`
 */
router.get('/gipp-rh/active-compensations',
    authMiddleware,
    canAny(['GIPPRH_VIEW_BENEFIT', 'GIPPRH_MANAGE_BENEFIT']),
    asyncHandler(gippRhController.getActiveCompensations));

/**
 * @route POST /gipp-rh/active-compensations
 * @description Cria uma nova compensação.
 * @access Requer `GIPPRH_CREATE_BENEFIT` ou `GIPPRH_MANAGE_BENEFIT`
 */
router.post('/gipp-rh/active-compensations',
    authMiddleware,
    canAny(['GIPPRH_CREATE_BENEFIT', 'GIPPRH_MANAGE_BENEFIT']),
    validate(postCompensationSchema),
    asyncHandler(gippRhController.postCompensations));

/**
 * @route PUT /gipp-rh/active-compensations
 * @description Atualiza uma compensação existente.
 * @access Requer `GIPPRH_UPDATE_BENEFIT` ou `GIPPRH_MANAGE_BENEFIT`
 */
router.put('/gipp-rh/active-compensations',
    authMiddleware,
    canAny(['GIPPRH_UPDATE_BENEFIT', 'GIPPRH_MANAGE_BENEFIT']),
    validate(putCompensationSchema),
    asyncHandler(gippRhController.putCompensations));

// ─── Beneficiários ────────────────────────────────────────────────────────────

/**
 * @route GET /gipp-rh/active-beneficiaries
 * @description Lista todos os beneficiários ativos com suas compensações.
 * @access Requer `GIPPRH_VIEW_BENEFIT` ou `GIPPRH_MANAGE_BENEFIT`
 */
router.get('/gipp-rh/active-beneficiaries',
    authMiddleware,
    canAny(['GIPPRH_VIEW_BENEFIT', 'GIPPRH_MANAGE_BENEFIT']),
    asyncHandler(gippRhController.getActiveBeneficiaries));

/**
 * @route POST /gipp-rh/active-beneficiaries
 * @description Associa um colaborador a uma compensação (novo beneficiário).
 * @access Requer `GIPPRH_CREATE_BENEFIT` ou `GIPPRH_MANAGE_BENEFIT`
 */
router.post('/gipp-rh/active-beneficiaries',
    authMiddleware,
    canAny(['GIPPRH_CREATE_BENEFIT', 'GIPPRH_MANAGE_BENEFIT']),
    validate(postBeneficiarySchema),
    asyncHandler(gippRhController.postBeneficiary));

/**
 * @route PUT /gipp-rh/active-beneficiaries
 * @description Atualiza os dados de um beneficiário existente.
 * @access Requer `GIPPRH_UPDATE_BENEFIT` ou `GIPPRH_MANAGE_BENEFIT`
 */
router.put('/gipp-rh/active-beneficiaries',
    authMiddleware,
    canAny(['GIPPRH_UPDATE_BENEFIT', 'GIPPRH_MANAGE_BENEFIT']),
    validate(putBeneficiarySchema),
    asyncHandler(gippRhController.putBeneficiary));

// ─── Colaboradores e Event Codes ──────────────────────────────────────────────

/**
 * @route GET /gipp-rh/employees-paginated
 * @description Retorna colaboradores com paginação e filtros (nome, filial, CC, CNPJ, status).
 * @access Requer `GIPPRH_VIEW_EMPLOYEE`
 */
router.get('/gipp-rh/employees-paginated',
    authMiddleware,
    canAll(['GIPPRH_VIEW_EMPLOYEE']),
    asyncHandler(gippRhController.getEmployeesPaginated));

/**
 * @route GET /gipp-rh/event-codes
 * @description Lista todos os códigos de evento disponíveis para lançamento de recibos.
 * @access Requer `GIPPRH_VIEW_EMPLOYEE`
 */
router.get('/gipp-rh/event-codes',
    authMiddleware,
    canAll(['GIPPRH_VIEW_EMPLOYEE']),
    asyncHandler(gippRhController.getEventCodes));

// ─── Recibos de Pagamento (CRUD) ──────────────────────────────────────────────

/**
 * @route GET /gipp-rh/payment-receipt
 * @description Consulta recibos de pagamento com filtros opcionais via query string.
 * @access Requer `GIPPRH_VIEW_RECEIPT` ou `GIPPRH_MANAGE_RECEIPT`
 */
router.get('/gipp-rh/payment-receipt',
    authMiddleware,
    canAny(['GIPPRH_VIEW_RECEIPT', 'GIPPRH_MANAGE_RECEIPT']),
    asyncHandler(gippRhController.getPaymentReceipts));

/**
 * @route POST /gipp-rh/payment-receipt
 * @description Insere um novo recibo de pagamento (CLT ou prestador).
 * @access Requer `GIPPRH_CREATE_RECEIPT` ou `GIPPRH_MANAGE_RECEIPT`
 */
router.post('/gipp-rh/payment-receipt',
    authMiddleware,
    canAny(['GIPPRH_CREATE_RECEIPT', 'GIPPRH_MANAGE_RECEIPT']),
    validate(postPaymentReceiptSchema),
    asyncHandler(gippRhController.postPaymentReceipt));

/**
 * @route PUT /gipp-rh/payment-receipt
 * @description Atualiza completamente um recibo de pagamento.
 * @access Requer `GIPPRH_UPDATE_RECEIPT` ou `GIPPRH_MANAGE_RECEIPT`
 */
router.put('/gipp-rh/payment-receipt',
    authMiddleware,
    canAny(['GIPPRH_UPDATE_RECEIPT', 'GIPPRH_MANAGE_RECEIPT']),
    validate(putPaymentReceiptSchema),
    asyncHandler(gippRhController.putPaymentReceipt));

/**
 * @route PATCH /gipp-rh/payment-receipt
 * @description Atualiza parcialmente um recibo de pagamento.
 * Apenas os campos presentes no body (exceto `id`) são modificados.
 * @access Requer `GIPPRH_UPDATE_RECEIPT` ou `GIPPRH_MANAGE_RECEIPT`
 */
router.patch('/gipp-rh/payment-receipt',
    authMiddleware,
    canAny(['GIPPRH_UPDATE_RECEIPT', 'GIPPRH_MANAGE_RECEIPT']),
    validate(patchPaymentReceiptSchema),
    asyncHandler(gippRhController.patchPaymentReceipt));

// ─── Download de Recibos (PDF) ─────────────────────────────────────────────────

/**
 * @route GET /gipp-rh/receipt/:branchCode
 * @description Gera e retorna o PDF do recibo de um colaborador (CLT) ou prestador
 * para uma referência específica.
 * Query params: `reference` (YYYYMM), `employee_code` ou `payee_id`.
 * @access Requer `GIPPRH_DOWNLOAD_RECEIPT`
 */
router.get('/gipp-rh/receipt/:branchCode',
    authMiddleware,
    canAll(['GIPPRH_DOWNLOAD_RECEIPT']),
    validate(getReceiptQuerySchema, 'query'),
    asyncHandler(gippRhController.downloadReceipt));

/**
 * @route POST /gipp-rh/receipt-by-group
 * @description Gera e retorna um PDF consolidado com todos os recibos dos grupos
 * de recibo informados. Body: `{ receipt_group_ids: string[] }`.
 *
 * Esta é a rota unificada para impressão de recibos independente do tipo de
 * pagamento (fechamento de jornada, compra de folga, etc.). O frontend deve
 * passar o `receipt_group_id` já conhecido na listagem de pagamentos.
 *
 * Depois de gerar o PDF, as jornadas dos recibos impressos que estavam em
 * 6 (Pagando) são fechadas para 4 (Finalizado). Reimpressão não altera status.
 * Contagens em `X-Work-Schedules-Confirmed` / `X-Work-Schedules-Skipped`.
 * Envie `confirm: false` no body para só imprimir.
 * @access Requer `GIPPRH_DOWNLOAD_RECEIPT`
 */
router.post('/gipp-rh/receipt-by-group',
    authMiddleware,
    canAll(['GIPPRH_DOWNLOAD_RECEIPT']),
    asyncHandler(gippRhController.downloadReceiptByGroup));

/**
 * @route GET /gipp-rh/receipt
 * @description Retorna recibos para exibição em tela (não PDF), filtrados por
 * colaborador, filial, intervalo de referência e tipo de pagamento.
 * @access Requer `GIPPRH_VIEW_RECEIPT` ou `GIPPRH_MANAGE_RECEIPT`
 */
router.get('/gipp-rh/receipt',
    authMiddleware,
    canAny(['GIPPRH_VIEW_RECEIPT', 'GIPPRH_DOWNLOAD_RECEIPT', 'GIPPRH_MANAGE_RECEIPT']),
    asyncHandler(gippRhController.getReceipt));

// ─── Tesouraria ───────────────────────────────────────────────────────────────

/**
 * @route GET /gipp-rh/treasury/receipts
 * @description Recibos de compra de folga para a tesouraria imprimir. Travada em
 * `payment_type_id = 6`.
 *
 * Query: `branchCode`, `referenceInit`, `referenceEnd`, `date_from`, `date_to`,
 * `workScheduleStatus` (opcional — padrão 6 "Pagando"; use 4 para reimprimir).
 *
 * Não altera estado: fechar as jornadas é o PATCH abaixo.
 * @access Requer `GIPPRH_DOWNLOAD_RECEIPT`
 */
router.get('/gipp-rh/treasury/receipts',
    authMiddleware,
    canAny(['GIPPRH_DOWNLOAD_RECEIPT', 'GIPPRH_MANAGE_RECEIPT']),
    asyncHandler(gippRhController.getTreasuryReceipts));

/**
 * @route PATCH /gipp-rh/treasury/confirm
 * @description Fecha as jornadas depois da impressão: 6 (Pagando) → 4 (Finalizado).
 * Body: `{ cod_work_schedules: string[] }`. Jornada fora do status 6 volta em
 * `skipped` sem derrubar o lote.
 * @access Requer `GIPPRH_DOWNLOAD_RECEIPT`
 */
router.patch('/gipp-rh/treasury/confirm',
    authMiddleware,
    canAny(['GIPPRH_DOWNLOAD_RECEIPT', 'GIPPRH_MANAGE_RECEIPT']),
    asyncHandler(gippRhController.confirmTreasuryPayment));

/**
 * @route GET /gipp-rh/payment-types
 * @description Lista todos os tipos de pagamento disponíveis.
 * @access Requer `GIPPRH_VIEW_RECEIPT` ou `GIPPRH_MANAGE_RECEIPT`
 */
router.get('/gipp-rh/payment-types',
    authMiddleware,
    canAny(['GIPPRH_DOWNLOAD_RECEIPT', 'GIPPRH_VIEW_RECEIPT', 'GIPPRH_MANAGE_RECEIPT']),
    asyncHandler(gippRhController.getPaymentTypes));

// ─── Payee (Freelancers e Prestadores) ────────────────────────────────────────

/**
 * @route GET /payee
 * @description Retorna a lista de prestadores/freelancers com filtros opcionais.
 * @access Requer `GIPPRH_VIEW_PAYEE` ou `GIPPRH_MANAGE_PAYEE`
 */
router.get('/payee',
    authMiddleware,
    canAny(['GIPPRH_VIEW_PAYEE', 'GIPPRH_MANAGE_PAYEE']),
    asyncHandler(payeeController.getPayees));

/**
 * @route POST /payee
 * @description Cadastra um novo prestador/freelancer.
 * @access Requer `GIPPRH_CREATE_PAYEE` ou `GIPPRH_MANAGE_PAYEE`
 */
router.post('/payee',
    authMiddleware,
    canAny(['GIPPRH_CREATE_PAYEE', 'GIPPRH_MANAGE_PAYEE']),
    validate(postPayeeSchema),
    asyncHandler(payeeController.postPayee));

/**
 * @route PUT /payee
 * @description Atualiza completamente um prestador existente.
 * @access Requer `GIPPRH_UPDATE_PAYEE` ou `GIPPRH_MANAGE_PAYEE`
 */
router.put('/payee',
    authMiddleware,
    canAny(['GIPPRH_UPDATE_PAYEE', 'GIPPRH_MANAGE_PAYEE']),
    validate(putPayeeSchema),
    asyncHandler(payeeController.putPayee));

/**
 * @route PATCH /payee
 * @description Atualiza parcialmente um prestador existente.
 * @access Requer `GIPPRH_UPDATE_PAYEE` ou `GIPPRH_MANAGE_PAYEE`
 */
router.patch('/payee',
    authMiddleware,
    canAny(['GIPPRH_UPDATE_PAYEE', 'GIPPRH_MANAGE_PAYEE']),
    validate(patchPayeeSchema),
    asyncHandler(payeeController.patchPayee));

/**
 * @route DELETE /payee/:id
 * @description Remove um prestador, desde que não possua recibos de pagamento vinculados.
 * @access Requer `GIPPRH_DELETE_PAYEE` ou `GIPPRH_MANAGE_PAYEE`
 */
router.delete('/payee/:id',
    authMiddleware,
    canAny(['GIPPRH_DELETE_PAYEE', 'GIPPRH_MANAGE_PAYEE']),
    asyncHandler(payeeController.deletePayee));

// ─── Gestão de Acessos — Usuários ─────────────────────────────────────────────

/**
 * @route GET /access/users
 * @description Lista usuários com filtros opcionais (ad_status, nome, matrícula, filial).
 * @access Requer `ACCESS_VIEW` ou `ACCESS_MANAGE`
 */
router.get('/access/users',
    authMiddleware,
    canAny(['ACCESS_VIEW', 'ACCESS_MANAGE']),
    asyncHandler(accessController.getUsers));

/**
 * @route GET /access/users/:id
 * @description Retorna um usuário pelo ID com seus papéis e permissões expandidos.
 * @access Requer `ACCESS_VIEW` ou `ACCESS_MANAGE`
 */
router.get('/access/users/:id',
    authMiddleware,
    canAny(['ACCESS_VIEW', 'ACCESS_MANAGE']),
    asyncHandler(accessController.getUserById));

/**
 * @route POST /access/users
 * @description Cria um novo usuário com senha hasheada.
 * @access Requer `ACCESS_MANAGE`
 */
router.post('/access/users',
    authMiddleware,
    canAny(['ACCESS_MANAGE']),
    validate(postUserSchema),
    asyncHandler(accessController.postUser));

/**
 * @route PUT /access/users/:id
 * @description Atualiza completamente um usuário (sem alterar senha ou campos de AD).
 * @access Requer `ACCESS_MANAGE`
 */
router.put('/access/users/:id',
    authMiddleware,
    canAny(['ACCESS_MANAGE']),
    validate(putUserSchema),
    asyncHandler(accessController.putUser));

/**
 * @route PATCH /access/users/:id
 * @description Atualiza parcialmente um usuário. Campos inválidos são ignorados.
 * @access Requer `ACCESS_MANAGE`
 */
router.patch('/access/users/:id',
    authMiddleware,
    canAny(['ACCESS_MANAGE']),
    validate(patchUserSchema),
    asyncHandler(accessController.patchUser));

/**
 * @route DELETE /access/users/:id
 * @description Desativa um usuário (soft-delete: ad_status = 'delete'). O registro permanece no banco.
 * @access Requer `ACCESS_MANAGE`
 */
router.delete('/access/users/:id',
    authMiddleware,
    canAny(['ACCESS_MANAGE']),
    asyncHandler(accessController.deleteUser));

/**
 * @route POST /access/users/:id/reset-password
 * @description Reseta a senha de um usuário LOCAL. Gera uma senha temporária
 * aleatória, devolve-a em claro UMA ÚNICA VEZ e marca o usuário para trocar no
 * próximo acesso (`must_change_password`).
 *
 * Recusa usuário de AD com 400: a senha dele vem do Active Directory e é
 * sobrescrita a cada login, então o reset não teria efeito.
 * @access Requer `ACCESS_MANAGE`
 */
router.post('/access/users/:id/reset-password',
    authMiddleware,
    canAny(['ACCESS_MANAGE']),
    asyncHandler(authController.resetUserPassword));

// ─── Gestão de Acessos — Vínculos Usuário ↔ Papel ─────────────────────────────

/**
 * @route GET /access/users/:id/roles
 * @description Retorna os papéis de um usuário.
 * @access Requer `ACCESS_VIEW` ou `ACCESS_MANAGE`
 */
router.get('/access/users/:id/roles',
    authMiddleware,
    canAny(['ACCESS_VIEW', 'ACCESS_MANAGE']),
    asyncHandler(accessController.getUserRoles));

/**
 * @route POST /access/users/:id/roles
 * @description Associa um ou mais papéis ao usuário. Body: `{ role_ids: number[] }`.
 * Papéis já vinculados são silenciosamente ignorados.
 * @access Requer `ACCESS_MANAGE`
 */
router.post('/access/users/:id/roles',
    authMiddleware,
    canAny(['ACCESS_MANAGE']),
    validate(assignRolesSchema),
    asyncHandler(accessController.assignRolesToUser));

/**
 * @route DELETE /access/users/:id/roles/:roleId
 * @description Desassocia um papel de um usuário.
 * @access Requer `ACCESS_MANAGE`
 */
router.delete('/access/users/:id/roles/:roleId',
    authMiddleware,
    canAny(['ACCESS_MANAGE']),
    asyncHandler(accessController.removeRoleFromUser));

// ─── Gestão de Acessos — Aplicações do Usuário ────────────────────────────────

/**
 * @route GET /access/users/:id/applications
 * @description Retorna as aplicações às quais o usuário tem acesso.
 * @access Requer `ACCESS_VIEW` ou `ACCESS_MANAGE`
 */
router.get('/access/users/:id/applications',
    authMiddleware,
    canAny(['ACCESS_VIEW', 'ACCESS_MANAGE']),
    asyncHandler(accessController.getUserApplications));

/**
 * @route POST /access/users/:id/applications
 * @description Concede acesso de um usuário a uma aplicação. Body: `{ application_id: number }`.
 * @access Requer `ACCESS_MANAGE`
 */
router.post('/access/users/:id/applications',
    authMiddleware,
    canAny(['ACCESS_MANAGE']),
    validate(grantApplicationSchema),
    asyncHandler(accessController.grantApplicationAccess));

/**
 * @route DELETE /access/users/:id/applications/:appId
 * @description Revoga o acesso de um usuário a uma aplicação.
 * @access Requer `ACCESS_MANAGE`
 */
router.delete('/access/users/:id/applications/:appId',
    authMiddleware,
    canAny(['ACCESS_MANAGE']),
    asyncHandler(accessController.revokeApplicationAccess));

// ─── Gestão de Acessos — Papéis (Roles) ───────────────────────────────────────

/**
 * @route GET /access/roles
 * @description Lista todos os papéis com suas permissões agregadas.
 * @access Requer `ACCESS_VIEW` ou `ACCESS_MANAGE`
 */
router.get('/access/roles',
    authMiddleware,
    canAny(['ACCESS_VIEW', 'ACCESS_MANAGE']),
    asyncHandler(accessController.getRoles));

/**
 * @route GET /access/roles/:id
 * @description Retorna um papel pelo ID com suas permissões.
 * @access Requer `ACCESS_VIEW` ou `ACCESS_MANAGE`
 */
router.get('/access/roles/:id',
    authMiddleware,
    canAny(['ACCESS_VIEW', 'ACCESS_MANAGE']),
    asyncHandler(accessController.getRoleById));

/**
 * @route POST /access/roles
 * @description Cria um novo papel. O nome é automaticamente convertido para maiúsculas.
 * @access Requer `ACCESS_MANAGE`
 */
router.post('/access/roles',
    authMiddleware,
    canAny(['ACCESS_MANAGE']),
    validate(postRoleSchema),
    asyncHandler(accessController.postRole));

/**
 * @route PUT /access/roles/:id
 * @description Atualiza nome e descrição de um papel.
 * @access Requer `ACCESS_MANAGE`
 */
router.put('/access/roles/:id',
    authMiddleware,
    canAny(['ACCESS_MANAGE']),
    validate(putRoleSchema),
    asyncHandler(accessController.putRole));

/**
 * @route DELETE /access/roles/:id
 * @description Remove um papel. Bloqueado se houver usuários vinculados (409).
 * @access Requer `ACCESS_MANAGE`
 */
router.delete('/access/roles/:id',
    authMiddleware,
    canAny(['ACCESS_MANAGE']),
    asyncHandler(accessController.deleteRole));

// ─── Gestão de Acessos — Vínculos Papel ↔ Permissão ──────────────────────────

/**
 * @route GET /access/roles/:id/permissions
 * @description Retorna as permissões de um papel.
 * @access Requer `ACCESS_VIEW` ou `ACCESS_MANAGE`
 */
router.get('/access/roles/:id/permissions',
    authMiddleware,
    canAny(['ACCESS_VIEW', 'ACCESS_MANAGE']),
    asyncHandler(accessController.getRolePermissions));

/**
 * @route POST /access/roles/:id/permissions
 * @description Associa uma ou mais permissões a um papel. Body: `{ permission_ids: number[] }`.
 * Permissões já vinculadas são silenciosamente ignoradas.
 * @access Requer `ACCESS_MANAGE`
 */
router.post('/access/roles/:id/permissions',
    authMiddleware,
    canAny(['ACCESS_MANAGE']),
    validate(assignPermissionsSchema),
    asyncHandler(accessController.assignPermissionsToRole));

/**
 * @route PUT /access/roles/:id/permissions
 * @description Substitui completamente as permissões de um papel (operação atômica).
 * Body: `{ permission_ids: number[] }`.
 * @access Requer `ACCESS_MANAGE`
 */
router.put('/access/roles/:id/permissions',
    authMiddleware,
    canAny(['ACCESS_MANAGE']),
    validate(setPermissionsSchema),
    asyncHandler(accessController.setRolePermissions));

/**
 * @route DELETE /access/roles/:id/permissions/:permissionId
 * @description Desassocia uma permissão de um papel.
 * @access Requer `ACCESS_MANAGE`
 */
router.delete('/access/roles/:id/permissions/:permissionId',
    authMiddleware,
    canAny(['ACCESS_MANAGE']),
    asyncHandler(accessController.removePermissionFromRole));

// ─── Gestão de Acessos — Permissões ───────────────────────────────────────────

/**
 * @route GET /access/permissions
 * @description Lista todas as permissões cadastradas.
 * @access Requer `ACCESS_VIEW` ou `ACCESS_MANAGE`
 */
router.get('/access/permissions',
    authMiddleware,
    canAny(['ACCESS_VIEW', 'ACCESS_MANAGE']),
    asyncHandler(accessController.getPermissions));

/**
 * @route POST /access/permissions
 * @description Cria uma nova permissão. O código é automaticamente convertido para maiúsculas.
 * @access Requer `ACCESS_MANAGE`
 */
router.post('/access/permissions',
    authMiddleware,
    canAny(['ACCESS_MANAGE']),
    validate(postPermissionSchema),
    asyncHandler(accessController.postPermission));

/**
 * @route PUT /access/permissions/:id
 * @description Atualiza código e descrição de uma permissão.
 * @access Requer `ACCESS_MANAGE`
 */
router.put('/access/permissions/:id',
    authMiddleware,
    canAny(['ACCESS_MANAGE']),
    validate(putPermissionSchema),
    asyncHandler(accessController.putPermission));

/**
 * @route DELETE /access/permissions/:id
 * @description Remove uma permissão. Bloqueado se estiver em uso por algum papel (409).
 * @access Requer `ACCESS_MANAGE`
 */
router.delete('/access/permissions/:id',
    authMiddleware,
    canAny(['ACCESS_MANAGE']),
    asyncHandler(accessController.deletePermission));

// ─── Gestão de Acessos — Aplicações ───────────────────────────────────────────

/**
 * @route GET /access/applications
 * @description Lista todas as aplicações cadastradas no sistema.
 * @access Requer `ACCESS_VIEW` ou `ACCESS_MANAGE`
 */
router.get('/access/applications',
    authMiddleware,
    canAny(['ACCESS_VIEW', 'ACCESS_MANAGE']),
    asyncHandler(accessController.getApplications));

// ─── Arquivos (_files) ────────────────────────────────────────────────────────

/**
 * @route GET /files/:fileId
 * @description Serve um arquivo registrado em `_files` pelo ID.
 * @access Autenticado
 */
router.get('/files/:fileId',
    authMiddleware,
    asyncHandler(filesController.serveFile));

/**
 * @route GET /files/:fileId/poster
 * @description Quadro de capa de um vídeo, como imagem. Evita que a miniatura
 *              do painel abra streaming do `.mp4` — ver o controller.
 * @access Autenticado
 */
router.get('/files/:fileId/poster',
    authMiddleware,
    asyncHandler(filesController.servePoster));

/**
 * @route DELETE /files/:fileId
 * @description Soft-delete de um arquivo (status = 0). Arquivo físico preservado.
 * @access Autenticado
 */
router.delete('/files/:fileId',
    authMiddleware,
    asyncHandler(filesController.deleteFile));

// ─── Chat — Arquivos (rota pública, sem auth) ─────────────────────────────────

/**
 * @route GET /chat/uploads/:filename
 * @description Serve um arquivo de chat (imagem ou documento) diretamente.
 * Rota pública para que <img src> e links de download funcionem sem credenciais.
 * Nomes de arquivo são gerados com UUID aleatório (não adivinháveis).
 * @access Público
 */
router.get('/chat/uploads/:filename',
    asyncHandler(chatController.serveFile));

// ─── Chat Direto ──────────────────────────────────────────────────────────────

/**
 * @route GET /chat/conversations
 * @description Lista todas as conversas diretas do usuário autenticado com contagem de não lidas.
 * @access Requer `USE_CHAT`
 */
router.get('/chat/conversations',
    authMiddleware,
    canAny(['CLPP_USE_CHAT']),
    asyncHandler(chatController.getConversations));

/**
 * @route GET /chat/messages
 * @description Retorna mensagens paginadas entre o usuário e um parceiro.
 * Query params: `with_user_id` (obrigatório), `page` (padrão 1).
 * @access Requer `USE_CHAT`
 */
router.get('/chat/messages',
    authMiddleware,
    canAny(['CLPP_USE_CHAT']),
    asyncHandler(chatController.getMessages));

/**
 * @route POST /chat/messages
 * @description Envia uma mensagem de texto. Body: `{ to_user_id, message, type? }`.
 * Após salvar, emite `chat:message` ao destinatário e `chat:delivered` ao remetente via WS.
 * @access Requer `USE_CHAT`
 */
router.post('/chat/messages',
    authMiddleware,
    canAny(['CLPP_USE_CHAT']),
    validate(sendMessageSchema),
    asyncHandler(chatController.sendMessage));

/**
 * @route POST /chat/messages/file
 * @description Envia um arquivo (imagem ou documento) como mensagem (multipart/form-data).
 * Campo obrigatório: `file`. Campo `to_user_id` no body.
 * Limite: 50 MB por arquivo. Arquivos executáveis são bloqueados.
 * @access Requer `USE_CHAT`
 */
router.post('/chat/messages/file',
    authMiddleware,
    canAny(['CLPP_USE_CHAT']),
    fileUpload.single('file'),          // multer memoryStorage via FileService
    asyncHandler(chatController.uploadFile));

/**
 * @route PUT /chat/messages/read
 * @description Marca como lidas todas as mensagens recebidas de um parceiro.
 * Body: `{ partner_id }`.
 * @access Requer `USE_CHAT`
 */
router.put('/chat/messages/read',
    authMiddleware,
    canAny(['CLPP_USE_CHAT']),
    validate(markAsReadSchema),
    asyncHandler(chatController.markAsRead));

// ─── GTPP — Gerenciador de Tarefas Peg Pesé ──────────────────────────────────

/**
 * @route GET /gtpp/states
 * @description Lista todos os estados de tarefa disponíveis (id, description, color).
 * Equivalente ao TaskState.php do PHP.
 * @access Requer `GTPP_USE`
 */
router.get('/gtpp/states',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppTaskController.getTaskStates));

/**
 * @route GET /gtpp/tasks
 * @description Lista tarefas onde o usuário é criador ou está vinculado.
 * @access Requer `GTPP_USE`
 */
router.get('/gtpp/tasks',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppTaskController.getTasks));

/**
 * @route GET /gtpp/tasks/board
 * @description Retorna tarefas de múltiplos estados em uma única requisição.
 * Query params: state_ids (csv), page, limit.
 * @access Requer `GTPP_USE`
 */
router.get('/gtpp/tasks/board',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppTaskController.getTasksBoard));

/**
 * @route GET /gtpp/tasks/:taskId/historic
 * @description Lista o histórico de mudanças de estado de uma tarefa.
 * @access Requer `GTPP_USE`
 */
router.get('/gtpp/tasks/:taskId/historic',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppTaskController.getTaskHistoric));

/**
 * @route GET /gtpp/tasks/:id
 * @description Retorna uma tarefa completa com itens e usuários vinculados.
 * @access Requer `GTPP_USE`
 */
router.get('/gtpp/tasks/:id',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppTaskController.getTaskById));

/**
 * @route POST /gtpp/tasks
 * @description Cria uma nova tarefa. Body: { title, description?, theme_id?, expire_day? }
 * @access Requer `GTPP_USE`
 */
router.post('/gtpp/tasks',
    authMiddleware,
    canAny(['GTPP_USE']),
    validate(postTaskSchema),
    asyncHandler(gtppTaskController.createTask));

/**
 * @route PUT /gtpp/tasks/:id/state
 * @description Atualiza o estado de uma tarefa. Body: { state_id, description? }
 * @access Requer `GTPP_USE` (apenas criador ou GTPP_MANAGE)
 */
router.put('/gtpp/tasks/:id/state',
    authMiddleware,
    canAny(['GTPP_USE']),
    validate(putTaskStateSchema),
    asyncHandler(gtppTaskController.updateTaskState));

/**
 * @route PUT /gtpp/tasks/:id/title
 * @description Atualiza o título de uma tarefa. Body: { description }
 * @access Requer `GTPP_USE` (apenas criador ou GTPP_MANAGE)
 */
router.put('/gtpp/tasks/:id/title',
    authMiddleware,
    canAny(['GTPP_USE']),
    validate(putTaskTitleSchema),
    asyncHandler(gtppTaskController.updateTaskTitle));

/**
 * @route PUT /gtpp/tasks/:id/description
 * @description Atualiza a descrição longa de uma tarefa. Body: { full_description }
 * @access Requer `GTPP_USE` (apenas criador ou GTPP_MANAGE)
 */
router.put('/gtpp/tasks/:id/description',
    authMiddleware,
    canAny(['GTPP_USE']),
    validate(putTaskDescriptionSchema),
    asyncHandler(gtppTaskController.updateTaskDescription));

/**
 * @route PUT /gtpp/tasks/:id/theme
 * @description Atualiza o tema de uma tarefa. Body: { theme_id }
 * @access Requer `GTPP_USE` (apenas criador ou GTPP_MANAGE)
 */
router.put('/gtpp/tasks/:id/theme',
    authMiddleware,
    canAny(['GTPP_USE']),
    validate(putTaskThemeSchema),
    asyncHandler(gtppTaskController.updateTaskTheme));

/**
 * @route DELETE /gtpp/tasks/:id
 * @description Remove uma tarefa permanentemente.
 * @access Requer `GTPP_USE` (apenas criador ou GTPP_MANAGE)
 */
router.delete('/gtpp/tasks/:id',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppTaskController.deleteTask));

// ─── GTPP — Itens de Tarefa ───────────────────────────────────────────────────

/**
 * @route GET /gtpp/tasks/:taskId/items
 * @description Lista itens ativos de uma tarefa.
 * @access Requer `GTPP_USE`
 */
router.get('/gtpp/tasks/:taskId/items',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppItemController.getTaskItems));

/**
 * @route POST /gtpp/tasks/:taskId/items
 * @description Cria um item na tarefa. Campo `file` opcional (multipart/form-data).
 * @access Requer `GTPP_USE`
 */
router.post('/gtpp/tasks/:taskId/items',
    authMiddleware,
    canAny(['GTPP_USE']),
    fileUpload.single('file'),
    validate(postTaskItemSchema),
    asyncHandler(gtppItemController.createTaskItem));

/**
 * @route PUT /gtpp/tasks/:taskId/items/:id
 * @description Atualiza um campo do item. Body: { action, ...campos }.
 * Actions: check | yes_no | description | file | note | assigned_to | status | position
 * @access Requer `GTPP_USE`
 */
router.put('/gtpp/tasks/:taskId/items/:id',
    authMiddleware,
    canAny(['GTPP_USE']),
    fileUpload.single('file'),
    validate(putTaskItemSchema),
    asyncHandler(gtppItemController.updateTaskItem));

/**
 * @route GET /gtpp/tasks/:taskId/items/:id/file
 * @description Serve o arquivo anexado ao item.
 *              Transparente: abstrai arquivo novo (_files) e legado (BLOB).
 * @access Requer `GTPP_USE`
 */
router.get('/gtpp/tasks/:taskId/items/:id/file',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppItemController.downloadItemFile));

/**
 * @route DELETE /gtpp/tasks/:taskId/items/:id
 * @description Soft-delete de um item (status = 0).
 * @access Requer `GTPP_USE`
 */
router.delete('/gtpp/tasks/:taskId/items/:id',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppItemController.deleteTaskItem));

// ─── GTPP — Respostas / Evidências ───────────────────────────────────────────

/**
 * @route GET /gtpp/items/:itemId/responses
 * @description Lista respostas ativas de um item de tarefa.
 * @access Requer `GTPP_USE`
 */
router.get('/gtpp/items/:itemId/responses',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppResponseController.getItemResponses));

/**
 * @route POST /gtpp/items/:itemId/responses
 * @description Adiciona uma resposta/evidência a um item, com 0..N anexos.
 * Body: { comment, file_names?, last_state_id?, new_state_id? }
 * `comment` é obrigatório APENAS quando não vem anexo — texto, anexo, ou os
 * dois; só é recusado o comentário sem conteúdo nenhum. Sem texto, a coluna
 * `comment` fica NULL.
 * Arquivos: campo `files` (múltiplo). O campo `file` (único) continua aceito
 * — formato antigo, remover quando o front migrar.
 * @access Requer `GTPP_USE`
 */
router.post('/gtpp/items/:itemId/responses',
    authMiddleware,
    canAny(['GTPP_USE']),
    fileUpload.fields([
        { name: 'files', maxCount: gtppResponseController.MAX_RESPONSE_FILES },
        { name: 'file', maxCount: 1 },   // @deprecated campo antigo, um anexo só
    ]),
    asyncHandler(gtppResponseController.createItemResponse));

/**
 * @route PUT /gtpp/items/:itemId/responses/:id
 * @description Atualiza o comentário de uma resposta.
 * Body: { comment }
 * @access Requer `GTPP_USE`
 */
router.put('/gtpp/items/:itemId/responses/:id',
    authMiddleware,
    canAny(['GTPP_USE']),
    validate(putTaskItemResponseSchema),
    asyncHandler(gtppResponseController.updateItemResponse));

/**
 * @route DELETE /gtpp/items/:itemId/responses/:id
 * @description Soft-delete de uma resposta (status = 0).
 * @access Requer `GTPP_USE`
 */
router.delete('/gtpp/items/:itemId/responses/:id',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppResponseController.deleteItemResponse));

/**
 * @route DELETE /gtpp/items/:itemId/responses/:id/files/:attachmentId
 * @description Soft-delete (status = 0) de UM anexo do comentário, sem afetar
 * os demais. `:attachmentId` é o `files[].id` devolvido no GET
 * (`gt_task_item_response_files.id`), não o `file_id` de `_files`.
 * @access Requer `GTPP_USE`
 */
router.delete('/gtpp/items/:itemId/responses/:id/files/:attachmentId',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppResponseController.deleteItemResponseFile));

// ─── GTPP — Escopo da Tarefa ──────────────────────────────────────────────────

/**
 * @route GET /gtpp/tasks/:taskId/scope
 * @description Lista os escopos (companhia/loja/CC) vinculados à tarefa.
 * @access Requer `GTPP_USE`
 */
router.get('/gtpp/tasks/:taskId/scope',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppScopeController.getTaskScope));

/**
 * @route POST /gtpp/tasks/:taskId/scope
 * @description Adiciona um escopo à tarefa. Body: { company_code?, branch_code?, cost_center_code? }
 * @access Requer `GTPP_USE`
 */
router.post('/gtpp/tasks/:taskId/scope',
    authMiddleware,
    canAny(['GTPP_USE']),
    validate(postTaskScopeSchema),
    asyncHandler(gtppScopeController.addTaskScope));

/**
 * @route DELETE /gtpp/tasks/:taskId/scope/:id
 * @description Remove um escopo da tarefa.
 * @access Requer `GTPP_USE`
 */
router.delete('/gtpp/tasks/:taskId/scope/:id',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppScopeController.removeTaskScope));

// ─── GTPP — Usuários da Tarefa ────────────────────────────────────────────────

/**
 * @route GET /gtpp/tasks/:taskId/users
 * @description Lista usuários com acesso GTPP, indicando vinculação à tarefa.
 * Retorna `{ user_id, name, file_id, check }` — `file_id` é a foto do
 * colaborador (null se não houver), no mesmo formato de `GET /users`.
 * @access Requer `GTPP_USE`
 */
router.get('/gtpp/tasks/:taskId/users',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppTaskUserController.getTaskUsers));

/**
 * @route PUT /gtpp/tasks/:taskId/users
 * @description Alterna vínculo de usuário à tarefa. Body: { user_id }
 * @access Requer `GTPP_USE` (apenas criador ou GTPP_MANAGE)
 */
router.put('/gtpp/tasks/:taskId/users',
    authMiddleware,
    canAny(['GTPP_USE']),
    validate(putTaskUserSchema),
    asyncHandler(gtppTaskUserController.toggleTaskUser));

// ─── GTPP — Mensagens (chat da tarefa) ────────────────────────────────────────

/**
 * @route GET /gtpp/tasks/:taskId/messages
 * @description Lista mensagens de uma tarefa.
 * @access Requer `GTPP_USE`
 */
router.get('/gtpp/tasks/:taskId/messages',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppMessageController.getTaskMessages));

/**
 * @route POST /gtpp/tasks/:taskId/messages
 * @description Envia uma mensagem. Campo `file` opcional (multipart/form-data).
 * Body: { description? } + campo file opcional.
 * @access Requer `GTPP_USE`
 */
router.post('/gtpp/tasks/:taskId/messages',
    authMiddleware,
    canAny(['GTPP_USE']),
    fileUpload.single('file'),
    validate(postTaskMessageSchema),
    asyncHandler(gtppMessageController.sendMessage));

/**
 * @route DELETE /gtpp/messages/:id
 * @description Remove uma mensagem. Query param: task_id (obrigatório).
 * @access Requer `GTPP_USE`
 */
router.delete('/gtpp/messages/:id',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppMessageController.deleteMessage));

// ─── GTPP — Notificações ──────────────────────────────────────────────────────

/**
 * @route GET /gtpp/notifications
 * @description Retorna e consome (deleta) notificações pendentes do usuário.
 * @access Requer `GTPP_USE`
 */
router.get('/gtpp/notifications',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppNotifyController.getNotifications));

// ─── GTPP — Temas ─────────────────────────────────────────────────────────────

/**
 * @route GET /gtpp/themes
 * @description Lista temas. Params: ?all=true | ?id=X | (padrão) temas do usuário.
 * @access Requer `GTPP_USE`
 */
router.get('/gtpp/themes',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppThemeController.getThemes));

/**
 * @route POST /gtpp/themes
 * @description Cria um novo tema. Body: { description_theme }
 * @access Requer `GTPP_USE`
 */
router.post('/gtpp/themes',
    authMiddleware,
    canAny(['GTPP_USE']),
    validate(postThemeSchema),
    asyncHandler(gtppThemeController.createTheme));

/**
 * @route PUT /gtpp/themes/:id
 * @description Atualiza a descrição de um tema. Body: { description_theme }
 * @access Requer `GTPP_USE`
 */
router.put('/gtpp/themes/:id',
    authMiddleware,
    canAny(['GTPP_USE']),
    validate(putThemeSchema),
    asyncHandler(gtppThemeController.updateTheme));

/**
 * @route DELETE /gtpp/themes/:id
 * @description Remove um tema permanentemente.
 * @access Requer `GTPP_USE`
 */
router.delete('/gtpp/themes/:id',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppThemeController.deleteTheme));

// ─── GTPP — Pontuação ─────────────────────────────────────────────────────────

/**
 * @route GET /gtpp/score
 * @description Pontuação: ?all=no (usuário atual), ?all=yes (todos), ?task_id=X (disqualify).
 * @access Requer `GTPP_USE`
 */
router.get('/gtpp/score',
    authMiddleware,
    canAny(['GTPP_USE']),
    asyncHandler(gtppScoreController.getScore));

/**
 * @route PUT /gtpp/score/disqualify
 * @description Atualiza desqualificação de tarefa. Query: task_id, disqualify (0|1).
 * @access Requer `GTPP_MANAGE`
 */
router.put('/gtpp/score/disqualify',
    authMiddleware,
    canAny(['GTPP_MANAGE']),
    validate(disqualifyQuerySchema, 'query'),
    asyncHandler(gtppScoreController.updateDisqualify));

// ─── Lojas ────────────────────────────────────────────────────────────────────

/**
 * @route GET /shops
 * @description Lista lojas. Query: ?company_id=X (opcional — filtra por empresa)
 * @access Requer autenticação
 */
router.get('/shops',
    authMiddleware,
    asyncHandler(shopController.getShops));

/**
 * @route GET /shops/audit
 * @description Auditoria de lojas: merge MySQL × sistema externo com flag in_mysql.
 * Query: ?source=protheus|consinco (obrigatório)
 * @access Requer autenticação
 */
router.get('/shops/audit',
    authMiddleware,
    asyncHandler(shopController.getShopsAudit));

// ─── EPP — Permissões ─────────────────────────────────────────────────────────
//
//  EPP_USE        → Leitura geral (produtos, menus, categorias, estoque)
//  EPP_ORDERS     → Ver, criar e atualizar pedidos e seus itens de venda
//  EPP_PRODUCTS   → Cadastrar e editar produtos, menus e log_menus
//  EPP_VIEW_RECIPE    → Acessar receitas técnicas Oracle (mobile, oracle_receipe)
//  EPP_MANAGE     → Administração total (exclusões, correções de estoque)
//
// ─────────────────────────────────────────────────────────────────────────────

// ─── EPP — Produtos ───────────────────────────────────────────────────────────

/**
 * @route GET /epp/products
 * @description Lista produtos.
 * Query: ?complete=1 (todos) | ?category=1 (categorias) |
 *        ?id_product=X | ?id_category_fk=X | ?status_prod=X (filtros)
 * @access EPP_USE | EPP_ORDERS | EPP_PRODUCTS | EPP_VIEW_RECIPE
 */
router.get('/epp/products',
    authMiddleware,
    canAny(['EPP_USE', 'EPP_ORDERS', 'EPP_PRODUCTS', 'EPP_VIEW_RECIPE']),
    asyncHandler(eppProductController.getProducts));

/**
 * @route GET /epp/products/consinco
 * @description Consulta produto no ERP Consinco (Oracle) por código de barras.
 * Query: codigo_acesso (obrigatório), lojas (obrigatório), full_store?
 * @access EPP_USE | EPP_ORDERS | EPP_PRODUCTS
 */
router.get('/epp/products/consinco',
    authMiddleware,
    canAny(['EPP_USE', 'EPP_ORDERS', 'EPP_PRODUCTS']),
    asyncHandler(eppProductController.getProductConsinco));

/**
 * @route GET /epp/products/:id
 * @description Retorna um produto pelo ID com nome da categoria.
 * @access EPP_USE | EPP_ORDERS | EPP_PRODUCTS | EPP_VIEW_RECIPE
 */
router.get('/epp/products/:id',
    authMiddleware,
    canAny(['EPP_USE', 'EPP_ORDERS', 'EPP_PRODUCTS', 'EPP_VIEW_RECIPE']),
    asyncHandler(eppProductController.getProductById));

/**
 * @route POST /epp/products
 * @description Cadastra um novo produto.
 * @access EPP_PRODUCTS | EPP_MANAGE
 */
router.post('/epp/products',
    authMiddleware,
    canAny(['EPP_PRODUCTS', 'EPP_MANAGE']),
    validate(postProductSchema),
    asyncHandler(eppProductController.createProduct));

/**
 * @route PUT /epp/products/:id
 * @description Atualiza completamente um produto.
 * @access EPP_PRODUCTS | EPP_MANAGE
 */
router.put('/epp/products/:id',
    authMiddleware,
    canAny(['EPP_PRODUCTS', 'EPP_MANAGE']),
    validate(putProductSchema),
    asyncHandler(eppProductController.updateProduct));

/**
 * @route PATCH /epp/products/:id/status
 * @description Altera apenas o status de um produto (ativo/inativo).
 * Body: { status_prod }
 * @access EPP_PRODUCTS | EPP_MANAGE
 */
router.patch('/epp/products/:id/status',
    authMiddleware,
    canAny(['EPP_PRODUCTS', 'EPP_MANAGE']),
    validate(patchProductStatusSchema),
    asyncHandler(eppProductController.changeProductStatus));

/**
 * @route DELETE /epp/products/:id
 * @description Remove um produto (bloqueado se houver pedidos vinculados).
 * @access EPP_PRODUCTS | EPP_MANAGE
 */
router.delete('/epp/products/:id',
    authMiddleware,
    canAny(['EPP_PRODUCTS', 'EPP_MANAGE']),
    asyncHandler(eppProductController.deleteProduct));

// ─── EPP — Menus ──────────────────────────────────────────────────────────────

/**
 * @route GET /epp/menus
 * @description Lista menus.
 * Query: ?registration=1 (todos) | ?id_menu=X | ?status=X | ?description=X
 * @access EPP_USE | EPP_ORDERS | EPP_PRODUCTS | EPP_VIEW_RECIPE
 */
router.get('/epp/menus',
    authMiddleware,
    canAny(['EPP_USE', 'EPP_ORDERS', 'EPP_PRODUCTS', 'EPP_VIEW_RECIPE']),
    asyncHandler(eppMenuController.getMenus));

/**
 * @route POST /epp/menus
 * @description Cria um novo menu. Body: { description, status? }
 * @access EPP_PRODUCTS | EPP_MANAGE
 */
router.post('/epp/menus',
    authMiddleware,
    canAny(['EPP_PRODUCTS', 'EPP_MANAGE']),
    validate(postMenuSchema),
    asyncHandler(eppMenuController.createMenu));

/**
 * @route PUT /epp/menus/:id
 * @description Atualiza um menu. Body: { description, status }
 * @access EPP_PRODUCTS | EPP_MANAGE
 */
router.put('/epp/menus/:id',
    authMiddleware,
    canAny(['EPP_PRODUCTS', 'EPP_MANAGE']),
    validate(putMenuSchema),
    asyncHandler(eppMenuController.updateMenu));

/**
 * @route DELETE /epp/menus/:id
 * @description Remove um menu (bloqueado se houver log_menus vinculados).
 * @access EPP_PRODUCTS | EPP_MANAGE
 */
router.delete('/epp/menus/:id',
    authMiddleware,
    canAny(['EPP_PRODUCTS', 'EPP_MANAGE']),
    asyncHandler(eppMenuController.deleteMenu));

// ─── EPP — Log Menus (configuração menu × produto) ───────────────────────────

/**
 * @route GET /epp/log-menus
 * @description Lista itens de menu com dados de produto e menu.
 * Query: ?plu_menu=X (filtra por PLU)
 * @access EPP_USE | EPP_ORDERS | EPP_PRODUCTS | EPP_VIEW_RECIPE
 */
router.get('/epp/log-menus',
    authMiddleware,
    canAny(['EPP_USE', 'EPP_ORDERS', 'EPP_PRODUCTS', 'EPP_VIEW_RECIPE']),
    asyncHandler(eppMenuController.getLogMenus));

/**
 * @route POST /epp/log-menus
 * @description Cria um item de log_menu. Body: { epp_id_menu, epp_id_product, plu_menu, type_base?, status_log_menu? }
 * @access EPP_PRODUCTS | EPP_MANAGE
 */
router.post('/epp/log-menus',
    authMiddleware,
    canAny(['EPP_PRODUCTS', 'EPP_MANAGE']),
    validate(postLogMenuSchema),
    asyncHandler(eppMenuController.createLogMenu));

/**
 * @route PUT /epp/log-menus/:id
 * @description Atualiza um item de log_menu.
 * @access EPP_PRODUCTS | EPP_MANAGE
 */
router.put('/epp/log-menus/:id',
    authMiddleware,
    canAny(['EPP_PRODUCTS', 'EPP_MANAGE']),
    validate(putLogMenuSchema),
    asyncHandler(eppMenuController.updateLogMenu));

/**
 * @route DELETE /epp/log-menus/menu
 * @description Remove itens por PLU + menu. Body: { plu_menu, epp_id_menu }
 * @access EPP_PRODUCTS | EPP_MANAGE
 */
router.delete('/epp/log-menus/menu',
    authMiddleware,
    canAny(['EPP_PRODUCTS', 'EPP_MANAGE']),
    asyncHandler(eppMenuController.deleteLogMenuByPlu));

/**
 * @route DELETE /epp/log-menus/:id
 * @description Remove um item de log_menu pelo ID.
 * @access EPP_PRODUCTS | EPP_MANAGE
 */
router.delete('/epp/log-menus/:id',
    authMiddleware,
    canAny(['EPP_PRODUCTS', 'EPP_MANAGE']),
    asyncHandler(eppMenuController.deleteLogMenuById));

// ─── EPP — Pedidos ────────────────────────────────────────────────────────────

/**
 * @route GET /epp/orders
 * @description Lista pedidos pendentes. Query: ?delivery_store=X
 * @access EPP_ORDERS | EPP_MANAGE
 */
router.get('/epp/orders',
    authMiddleware,
    canAny(['EPP_ORDERS', 'EPP_MANAGE']),
    asyncHandler(eppOrderController.getOrders));

/**
 * @route GET /epp/orders/:id
 * @description Retorna um pedido pelo ID.
 * @access EPP_ORDERS | EPP_MANAGE
 */
router.get('/epp/orders/:id',
    authMiddleware,
    canAny(['EPP_ORDERS', 'EPP_MANAGE']),
    asyncHandler(eppOrderController.getOrderById));

/**
 * @route POST /epp/orders/bulk
 * @description Cria um pedido e todos os seus itens em uma única transação MySQL.
 * Body: { ...camposDoPedido, items: [{ epp_id_product, quantity, price, menu? }] }
 * @access EPP_ORDERS | EPP_MANAGE
 */
router.post('/epp/orders/bulk',
    authMiddleware,
    canAny(['EPP_ORDERS', 'EPP_MANAGE']),
    validate(postOrderBulkSchema),
    asyncHandler(eppOrderController.createOrderBulk));

/**
 * @route GET /epp/orders/consinco/:nroPedido/ecommerce
 * @description Consulta pedido do ecommerce na Consinco e retorna header + itens com flag registered e is_menu.
 * @access EPP_ORDERS | EPP_MANAGE
 */
router.get('/epp/orders/consinco/:nroPedido/ecommerce',
    authMiddleware,
    canAny(['EPP_USE_ECOMMERCE', 'EPP_MANAGE']),
    asyncHandler(eppOrderController.getEcommerceOrder));

/**
 * @route POST /epp/orders/consinco/:nroPedido/ecommerce
 * @description Confirma pedido do ecommerce: insere apenas itens cadastrados, retorna warnings para os demais.
 * Body: { delivery_date, delivery_hour, delivery_store }
 * @access EPP_ORDERS | EPP_MANAGE
 */
router.post('/epp/orders/consinco/:nroPedido/ecommerce',
    authMiddleware,
    canAny(['EPP_USE_ECOMMERCE', 'EPP_MANAGE']),
    validate(postEcommerceOrderSchema),
    asyncHandler(eppOrderController.confirmEcommerceOrder));

/**
 * @route POST /epp/orders
 * @description Cria um pedido com validação de data de entrega.
 * @access EPP_ORDERS | EPP_MANAGE
 */
router.post('/epp/orders',
    authMiddleware,
    canAny(['EPP_ORDERS', 'EPP_MANAGE']),
    validate(postOrderSchema),
    asyncHandler(eppOrderController.createOrder));

/**
 * @route PUT /epp/orders/:id
 * @description Atualiza completamente um pedido.
 * @access EPP_ORDERS | EPP_MANAGE
 */
router.put('/epp/orders/:id',
    authMiddleware,
    canAny(['EPP_ORDERS', 'EPP_MANAGE']),
    validate(putOrderSchema),
    asyncHandler(eppOrderController.updateOrder));

/**
 * @route PATCH /epp/orders/:id/status
 * @description Marca pedido como entregue (1) ou cancelado (2). Body: { delivered }
 * @access EPP_ORDERS | EPP_MANAGE
 */
router.patch('/epp/orders/:id/status',
    authMiddleware,
    canAny(['EPP_ORDERS', 'EPP_MANAGE']),
    validate(patchOrderStatusSchema),
    asyncHandler(eppOrderController.changeOrderStatus));

/**
 * @route DELETE /epp/orders/:id
 * @description Remove um pedido (bloqueado se houver itens de venda vinculados).
 * @access EPP_MANAGE
 */
router.delete('/epp/orders/:id',
    authMiddleware,
    canAny(['EPP_MANAGE']),
    asyncHandler(eppOrderController.deleteOrder));

// ─── EPP — Log de Vendas (itens do pedido) ───────────────────────────────────

/**
 * @route GET /epp/log-sales
 * @description Lista itens de venda.
 * Query: ?epp_id_order=X | ?controller=1 [+filtros] | ?mobile=1 | ?oracle_receipe=1&seq_produto=X
 * @access EPP_ORDERS (itens de pedido) | EPP_VIEW_RECIPE (mobile + receita Oracle) | EPP_MANAGE
 */
router.get('/epp/log-sales',
    authMiddleware,
    canAny(['EPP_ORDERS', 'EPP_VIEW_RECIPE', 'EPP_MANAGE']),
    asyncHandler(eppLogSaleController.getLogSales));

/**
 * @route POST /epp/log-sales
 * @description Cria um item de venda. Body: { epp_id_order, epp_id_product, quantity, price, menu? }
 * @access EPP_ORDERS | EPP_MANAGE
 */
router.post('/epp/log-sales',
    authMiddleware,
    canAny(['EPP_ORDERS', 'EPP_MANAGE']),
    validate(postLogSaleSchema),
    asyncHandler(eppLogSaleController.createLogSale));

/**
 * @route PUT /epp/log-sales/:id
 * @description Atualiza um item de venda.
 * @access EPP_ORDERS | EPP_MANAGE
 */
router.put('/epp/log-sales/:id',
    authMiddleware,
    canAny(['EPP_ORDERS', 'EPP_MANAGE']),
    validate(putLogSaleSchema),
    asyncHandler(eppLogSaleController.updateLogSale));

/**
 * @route DELETE /epp/log-sales/order/:orderId
 * @description Remove todos os itens de um pedido.
 * @access EPP_MANAGE
 */
router.delete('/epp/log-sales/order/:orderId',
    authMiddleware,
    canAny(['EPP_MANAGE']),
    asyncHandler(eppLogSaleController.deleteLogSaleByOrder));

/**
 * @route DELETE /epp/log-sales/:id
 * @description Remove um item de venda pelo ID.
 * @access EPP_ORDERS | EPP_MANAGE
 */
router.delete('/epp/log-sales/:id',
    authMiddleware,
    canAny(['EPP_ORDERS', 'EPP_MANAGE']),
    asyncHandler(eppLogSaleController.deleteLogSaleById));

// ─── EPP — Estoque ────────────────────────────────────────────────────────────

/**
 * @route GET /epp/stock
 * @description Consulta estoque.
 * Query: ?stock=1[&id_product_fk=X] | ?history=1&id_product_fk=X | ?pending_production=1[&page=N]
 * @access EPP_USE | EPP_ORDERS | EPP_VIEW_RECIPE | EPP_MANAGE
 */
router.get('/epp/stock',
    authMiddleware,
    canAny(['EPP_USE', 'EPP_ORDERS', 'EPP_VIEW_RECIPE', 'EPP_MANAGE']),
    asyncHandler(eppStockController.getStock));

/**
 * @route POST /epp/stock
 * @description Registra entrada (qty > 0) ou saída (qty < 0) de estoque.
 * Body: { id_product_fk, stock_quantity, created_by, updated_by, measure }
 * @access EPP_USE | EPP_ORDERS | EPP_MANAGE
 */
router.post('/epp/stock',
    authMiddleware,
    canAny(['EPP_USE', 'EPP_ORDERS', 'EPP_MANAGE']),
    validate(postStockSchema),
    asyncHandler(eppStockController.createStock));

/**
 * @route PUT /epp/stock/:id
 * @description Atualiza um registro de estoque (apenas administradores).
 * Body: { updated_by, + campos opcionais }
 * @access EPP_MANAGE
 */
router.put('/epp/stock/:id',
    authMiddleware,
    canAny(['EPP_MANAGE']),
    validate(putStockSchema),
    asyncHandler(eppStockController.updateStock));

// ─── BPPP — Busca de Preço ────────────────────────────────────────────────────
//
// Migrado de Controller/BPPP/Product.php (+ DAO/BPPP/Product.php). Consulta
// somente leitura no ERP Consinco (Oracle) — nada é gravado.
//
//  BPPP_USE    → Consultar preço/estoque de produto
//  BPPP_MANAGE → Administração do módulo (inclui a consulta)
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route GET /bppp/products
 * @description Consulta produto no Consinco por loja. Exige `shop_id` e
 * exatamente UM critério: `plu` (alias legado: `id`), `ean` ou `description`.
 * PLU/EAN retornam 1 item; descrição retorna até 25 itens ordenados.
 * Resposta: [{ plu, description, barcode, store, price, price_promotion, promotion, status }]
 * @access BPPP_USE | BPPP_MANAGE
 */
router.get('/bppp/products',
    authMiddleware,
    canAny(['BPPP_USE', 'BPPP_MANAGE']),
    validate(searchProductQuerySchema, 'query'),
    asyncHandler(bpppProductController.searchProducts));

/**
 * @route GET /bppp/shops
 * @description Lojas disponíveis para consulta no BPPP — só as que possuem
 * código no Consinco (`_shop_codes.system_name = 'consinco'`). O `number` de
 * cada loja é o valor a enviar como `shop_id` nas demais rotas do módulo.
 * Resposta: `[{ id, number, description, cnpj }]`
 * @access BPPP_USE | BPPP_MANAGE
 */
router.get('/bppp/shops',
    authMiddleware,
    canAny(['BPPP_USE', 'BPPP_MANAGE']),
    asyncHandler(shopController.getShopsForBppp));

/**
 * @route GET /bppp/departments/:departmentId/products
 * @description Lista os produtos de um departamento em uma loja — só itens com
 * código de balança, ativos para venda no segmento 1. Exige `shop_id` na query.
 * Resposta: mesmo formato de `GET /bppp/products`; `[]` quando o departamento
 * não tem item (ausência não é erro).
 *
 * Migrado de `DAOProduct::SelectByShopAndDepartment`, que existia no DAO do PHP
 * mas nunca teve controller — o contrato HTTP nasce aqui.
 * @access BPPP_USE | BPPP_MANAGE
 */
router.get('/bppp/departments/:departmentId/products',
    authMiddleware,
    canAny(['BPPP_USE', 'BPPP_MANAGE']),
    validate(listByDepartmentQuerySchema, 'query'),
    asyncHandler(bpppProductController.listByDepartment));

// ─── GAPP — Ativos ────────────────────────────────────────────────────────────
//
// Migrado de Controller/GAPP_V2/Active.php. A procedure `sp_gapp_save_active_v2`
// faz upsert atômico de ativo + (se is_vehicle=1) veículo + (se enviado) seguro,
// numa única transação com rollback total em caso de erro.
//
// A procedure legada `sp_gapp_save_active` NÃO foi alterada — o Active.php em
// PHP continua chamando-a normalmente enquanto ambos convivem.
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route POST /gapp/active
 * @description Cria um ativo. Se `is_vehicle=1`, exige `vehicle` e cria o
 * veículo junto. Se vier `insurance`, cria o seguro na mesma transação.
 * @access Requer `GAPP_CREATE_ACTIVE`
 */
router.post('/gapp/active',
    authMiddleware,
    canAll(['GAPP_CREATE_ACTIVE']),
    validate(createActiveSchema),
    validateVehicleAndInsurancePayload,
    asyncHandler(gappActiveController.createActive));

/**
 * @route PUT /gapp/active
 * @description Atualiza um ativo existente (`active_id` obrigatório). Mesma
 * lógica atômica do POST para veículo/seguro.
 * @access Requer `GAPP_UPDATE_ACTIVE`
 */
router.put('/gapp/active',
    authMiddleware,
    canAll(['GAPP_UPDATE_ACTIVE']),
    validate(updateActiveSchema),
    validateVehicleAndInsurancePayload,
    asyncHandler(gappActiveController.updateActive));

// ─── GAPP — Seguro (standalone) ────────────────────────────────────────────────
//
// Migrado de Controller/GAPP/Insurance.php. Uso: editar/criar o seguro de um
// veículo que já existe, sem recriar o ativo/veículo. Upsert por
// `active_id_fk` via `sp_gapp_save_insurance` (mesmos workers da rota acima).
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route POST /gapp/insurance
 * @description Cria o seguro de um veículo (`active_id_fk` obrigatório).
 * @access Requer `GAPP_CREATE_INSURANCE`
 */
router.post('/gapp/insurance',
    authMiddleware,
    canAll(['GAPP_CREATE_INSURANCE']),
    validate(createInsuranceSchema),
    asyncHandler(gappInsuranceController.createInsurance));

/**
 * @route PUT /gapp/insurance
 * @description Atualiza o seguro de um veículo (`active_id_fk` obrigatório).
 * @access Requer `GAPP_UPDATE_INSURANCE`
 */
router.put('/gapp/insurance',
    authMiddleware,
    canAll(['GAPP_UPDATE_INSURANCE']),
    validate(updateInsuranceSchema),
    asyncHandler(gappInsuranceController.updateInsurance));

// ─── GAPP — Consulta (GET) ──────────────────────────────────────────────────

/**
 * @route GET /gapp/active
 * @description Lista/filtra ativos, com paginação.
 * @access Requer `GAPP_VIEW_ACTIVE`
 */
router.get('/gapp/active',
    authMiddleware,
    canAll(['GAPP_VIEW_ACTIVE']),
    validate(listActiveQuerySchema, 'query'),
    asyncHandler(gappActiveController.listActive));

/**
 * @route GET /gapp/active/:id
 * @description Retorna um ativo com dados completos (unidade, classe, usuário,
 * grupo de trabalho) e, se for veículo, também o veículo e o seguro ativo.
 * @access Requer `GAPP_VIEW_ACTIVE`
 */
router.get('/gapp/active/:id',
    authMiddleware,
    canAll(['GAPP_VIEW_ACTIVE']),
    asyncHandler(gappActiveController.getActiveById));

/**
 * @route GET /gapp/vehicle
 * @description Lista/filtra veículos (join com o ativo pai), com paginação.
 * @access Requer `GAPP_VIEW_VEHICLE`
 */
router.get('/gapp/vehicle',
    authMiddleware,
    canAll(['GAPP_VIEW_VEHICLE']),
    validate(listVehicleQuerySchema, 'query'),
    asyncHandler(gappVehicleController.listVehicles));

/**
 * @route GET /gapp/vehicle/:id
 * @description Retorna um veículo (por vehicle_id) com dados do ativo pai e
 * o seguro ativo, se houver.
 * @access Requer `GAPP_VIEW_VEHICLE`
 */
router.get('/gapp/vehicle/:id',
    authMiddleware,
    canAll(['GAPP_VIEW_VEHICLE']),
    asyncHandler(gappVehicleController.getVehicleById));

/**
 * @route GET /gapp/insurance
 * @description Lista/filtra seguros — inclui registros desativados (histórico).
 * Use `active_id_fk` para ver todo o histórico de apólices de um veículo.
 * @access Requer `GAPP_VIEW_INSURANCE`
 */
router.get('/gapp/insurance',
    authMiddleware,
    canAll(['GAPP_VIEW_INSURANCE']),
    validate(listInsuranceQuerySchema, 'query'),
    asyncHandler(gappInsuranceController.listInsurance));

/**
 * @route GET /gapp/insurance/:id
 * @description Retorna um seguro (por id_insurance) com seguradora, tipo de
 * cobertura e utilização resolvidos por nome, e a placa do veículo.
 * @access Requer `GAPP_VIEW_INSURANCE`
 */
router.get('/gapp/insurance/:id',
    authMiddleware,
    canAll(['GAPP_VIEW_INSURANCE']),
    asyncHandler(gappInsuranceController.getInsuranceById));

// ─── GAPP — Lojas ────────────────────────────────────────────────────────────

/**
 * @route GET /gapp/store
 * @description Lista/filtra lojas, com paginação.
 * @access Requer `GAPP_VIEW_STORE`
 */
router.get('/gapp/store',
    authMiddleware,
    canAll(['GAPP_VIEW_STORE']),
    validate(listStoreQuerySchema, 'query'),
    asyncHandler(gappStoreController.listStores));

/**
 * @route GET /gapp/store/:id
 * @description Retorna uma loja pelo store_id.
 * @access Requer `GAPP_VIEW_STORE`
 */
router.get('/gapp/store/:id',
    authMiddleware,
    canAll(['GAPP_VIEW_STORE']),
    asyncHandler(gappStoreController.getStoreById));

/**
 * @route POST /gapp/store
 * @description Cria uma loja.
 * @access Requer `GAPP_CREATE_STORE`
 */
router.post('/gapp/store',
    authMiddleware,
    canAll(['GAPP_CREATE_STORE']),
    validate(createStoreSchema),
    asyncHandler(gappStoreController.createStore));

/**
 * @route PUT /gapp/store/:id
 * @description Atualiza uma loja.
 * @access Requer `GAPP_UPDATE_STORE`
 */
router.put('/gapp/store/:id',
    authMiddleware,
    canAll(['GAPP_UPDATE_STORE']),
    validate(updateStoreSchema),
    asyncHandler(gappStoreController.updateStore));

/**
 * @route DELETE /gapp/store/:id
 * @description Exclusão lógica de loja (gapp_store) — nunca remove a linha,
 * só desativa via status_store = 0.
 * @access Requer `GAPP_DELETE_STORE`
 */
router.delete('/gapp/store/:id',
    authMiddleware,
    canAll(['GAPP_DELETE_STORE']),
    asyncHandler(gappStoreController.deleteStore));

// ─── GAPP — Despesas de Ativo ───────────────────────────────────────────────

/**
 * @route GET /gapp/expenses
 * @description Lista/filtra despesas de qualquer ativo, com paginação.
 * Restrito ao work_group_fk do usuário autenticado.
 * @access Requer `GAPP_VIEW_EXPENSE`
 */
router.get('/gapp/expenses',
    authMiddleware,
    canAll(['GAPP_VIEW_EXPENSE']),
    validate(listExpensesQuerySchema, 'query'),
    asyncHandler(gappExpensesController.listExpenses));

/**
 * @route GET /gapp/expenses/vehicles
 * @description Lista/filtra despesas restritas a ativos que são veículo —
 * permite filtrar por placa (`license_plates`) e unidade. Baseada na
 * pcr_select_filtered_expenses (legado), com isolamento por work_group_fk.
 * @access Requer `GAPP_VIEW_EXPENSE`
 */
router.get('/gapp/expenses/vehicles',
    authMiddleware,
    canAll(['GAPP_VIEW_EXPENSE']),
    validate(listVehicleExpensesQuerySchema, 'query'),
    asyncHandler(gappExpensesController.listVehicleExpenses));

/**
 * @route GET /gapp/expenses/:id
 * @description Retorna uma despesa com o detalhe do tipo aninhado
 * (`fuel`/`maintenance`/`sinister`/`fine`/`insurance` — o que não for do
 * tipo vem `null`). Restrito ao work_group_fk do usuário.
 * @access Requer `GAPP_VIEW_EXPENSE`
 */
router.get('/gapp/expenses/:id',
    authMiddleware,
    canAll(['GAPP_VIEW_EXPENSE']),
    asyncHandler(gappExpensesController.getExpenseById));

/**
 * @route POST /gapp/expenses
 * @description Cria uma despesa. `user_id_fk` é sempre resolvido do usuário
 * autenticado. Se `active_id_fk` vier, precisa pertencer ao work_group_fk
 * do usuário. O objeto de detalhe exigido depende de `exp_type_id_fk`
 * (1=fuel, 2=maintenance, 3=sinister, 4=fine, 5=insurance; 6=Outros não
 * exige nenhum) — tudo gravado numa única transação.
 * @access Requer `GAPP_CREATE_EXPENSE`
 */
router.post('/gapp/expenses',
    authMiddleware,
    canAll(['GAPP_CREATE_EXPENSE']),
    validate(createExpenseSchema),
    validateExpenseTypePayload,
    asyncHandler(gappExpensesController.createExpense));

/**
 * @route PUT /gapp/expenses/:id
 * @description Atualiza uma despesa existente e seu detalhe (mesma regra
 * de objeto por tipo do create). fuel/maintenance/sinister/fine são
 * substituídos por completo; Seguro é atualizado in-place (nunca recriado).
 * @access Requer `GAPP_UPDATE_EXPENSE`
 */
router.put('/gapp/expenses/:id',
    authMiddleware,
    canAll(['GAPP_UPDATE_EXPENSE']),
    validate(updateExpenseSchema),
    validateExpenseTypePayload,
    asyncHandler(gappExpensesController.updateExpense));

// ─── GAPP — NF de despesas de ativo ───────────────────────────────────────────────
/**
 * @route GET /gapp/nf
 * @description Lista todas as notas fiscais registradas
 * @access GAPP_VIEW_NF
 */
router.get('/gapp/nf',
    authMiddleware,
    canAll(['GAPP_VIEW_NF']),
    asyncHandler(gappNfController.listNf)
);

/**
 * @route GET /gapp/nf/:number_nf
 * @description Recebe o numero da nota fiscal como parametro
 * e retorna a nota fiscal com todos os cupons vinculados a ela.
 * @access GAPP_VIEW_NF
 */
router.get('/gapp/nf/:number_nf',
    authMiddleware,
    canAll(['GAPP_VIEW_NF']),
    asyncHandler(gappNfController.listNfById)
);

/**
 * @route GET /gapp/nf-coupon
 * @description Lista todos os cupons que estão livres para serem
 * vinculados a uma nota fiscal
 * @access GAPP_VIEW_NF
 */
router.get('/gapp/nf-coupon',
    authMiddleware,
    canAll(['GAPP_VIEW_NF']),
    asyncHandler(gappNfController.listCoupon)
);

/**
 * @route POST /gapp/nf/:number_nf
 * @description Realiza o registro de uma NF
 * @access GAPP_CREATE_NF
 */
router.post('/gapp/nf',
    authMiddleware,
    canAll(['GAPP_CREATE_NF']),
    validate(createNfSchema),
    asyncHandler(gappNfController.createNf)
)
/**
 * @route PUT /gapp/nf/:id
 * @description Realiza o update de uma NF, utiliza o id como parametro
 * para identificar o registro
 * @access GAPP_UPDATE_NF
 */
router.put('/gapp/nf/:id',
    authMiddleware,
    canAll(['GAPP_UPDATE_NF']),
    validate(updateNfSchema),
    asyncHandler(gappNfController.updateNf)
)
/**
 * @route DELETE /gapp/nf/:id
 * @description Deleta o registro de uma NF com base no seu id
 * @access GAPP_DELETE_NF
 */
router.delete('/gapp/nf/:id',
    authMiddleware,
    canAll(['GAPP_DELETE_NF']),
    asyncHandler(gappNfController.deleteNF)
)

// ─── GAPP ─ Infrações ─────────────────────────────────────────────────────────

/**
 * @route GET /gapp/infractions
 * @description Lista todos os registros de infrações 
 * @access GAPP_VIEW_INFRACTIONS
 */
router.get('/gapp/infractions',
    authMiddleware,
    canAll(['GAPP_VIEW_INFRACTIONS']),
    asyncHandler(gappInfractionsController.list)
);
/**
 * @route GET /gapp/infractions/:id
 * @description Lista o registro de uma infração com base no id
 * @access GAPP_VIEW_INFRACTIONS
 */
router.get('/gapp/infractions/:id',
    authMiddleware,
    canAll(['GAPP_VIEW_INFRACTIONS']),
    asyncHandler(gappInfractionsController.listById)
);
/**
 * @route POST /gapp/infractions
 * @description Registra uma nova infração
 * @access GAPP_VIEW_INFRACTIONS
 */
router.post('/gapp/infractions',
    authMiddleware,
    canAll(['GAPP_CREATE_INFRACTIONS']),
    asyncHandler(gappInfractionsController.createInfraction)
);
/**
 * @route PUT /gapp/infractions/:id
 * @description Atualiza uma infração com base o id 
 * @access GAPP_VIEW_INFRACTIONS
 */
router.put('/gapp/infractions/:id',
    authMiddleware,
    canAll(['GAPP_UPDATE_INFRACTIONS']),
    asyncHandler(gappInfractionsController.updateInfraction)
);

// ─── GAPP ─ Movimentações ─────────────────────────────────────────────────────

/**
 * @route GET /gapp/movimentation
 * @description Lista todos os registros de movimentação 
 * @access GAPP_VIEW_MOVIMENTATION
 */
router.get('/gapp/movimentation',
    authMiddleware,
    canAll(['GAPP_VIEW_MOVIMENTATION']),
    asyncHandler(gappMovimentationController.list)
);
/**
 * @route GET /gapp/movimentation/:id
 * @description Lista o registro de uma movimentação com base no id
 * @access GAPP_VIEW_MOVIMENTATION
 */
router.get('/gapp/movimentation/:id',
    authMiddleware,
    canAll(['GAPP_VIEW_MOVIMENTATION']),
    asyncHandler(gappMovimentationController.listById)
);
/**
 * @route POST /gapp/movimentation
 * @description Registra uma nova movimentação
 * @access GAPP_CREATE_MOVIMENTATION
 */
router.post('/gapp/movimentation',
    authMiddleware,
    canAll(['GAPP_CREATE_MOVIMENTATION']),
    asyncHandler(gappMovimentationController.createMovimentation)
);
/**
 * @route PUT /gapp/movimentation/:id
 * @description Atualiza uma movimentação com base o id 
 * @access GAPP_UPDATE_MOVIMENTATION
 */
router.put('/gapp/movimentation/:id',
    authMiddleware,
    canAll(['GAPP_UPDATE_MOVIMENTATION']),
    asyncHandler(gappMovimentationController.updateMovimentation)
);

// ─── GAPP — Settins ───────────────────────────────────────────────────────────
// Rotas de configurações relacionadas ao modulo gapp

/**
 * @route POST /gapp/settings/active-type
 * @description Cria um novo tipo de ativo
 * @access GAPP_CREATE_SETTIGNS
 */
router.post('/gapp/settings/active-type',
    authMiddleware,
    canAll(['GAPP_CREATE_SETTIGNS']),
    asyncHandler(gappSettingsController.createActiveType)
);

/**
 * @route PUT /gapp/settings/active-type/:id
 * @description Atualiza um tipo de ativo com base no id
 * @access GAPP_UPDATE_SETTIGNS
 */
router.put('/gapp/settings/active-type/:id',
    authMiddleware,
    canAll(['GAPP_UPDATE_SETTIGNS']),
    asyncHandler(gappSettingsController.updateActiveType)
);

/**
 * @route POST /gapp/settings/active-class
 * @description Cria um novo tipo de class para ativos
 * @access GAPP_CREATE_SETTIGNS
 */
router.post('/gapp/settings/active-class',
    authMiddleware,
    canAll(['GAPP_CREATE_SETTIGNS']),
    asyncHandler(gappSettingsController.createActiveClass)
);

/**
 * @route PUT /gapp/settings/active-class/:id
 * @description Atualiza um tipo de classe com base no id
 * @access GAPP_UPDATE_SETTIGNS
 */
router.put('/gapp/settings/active-class/:id',
    authMiddleware,
    canAll(['GAPP_UPDATE_SETTIGNS']),
    asyncHandler(gappSettingsController.updateActiveClass)
);

/**
 * @route POST /gapp/settings/company
 * @description Cria uma nova compania
 * @access GAPP_CREATE_SETTIGNS
 */
router.post('/gapp/settings/company',
    authMiddleware,
    canAll(['GAPP_CREATE_SETTIGNS']),
    asyncHandler(gappSettingsController.createCompany)
);

/**
 * @route PUT /gapp/settings/company/:id
 * @description Atualiza uma companhia com base no id
 * @access GAPP_UPDATE_SETTIGNS
 */
router.put('/gapp/settings/company/:id',
    authMiddleware,
    canAll(['GAPP_UPDATE_SETTIGNS']),
    asyncHandler(gappSettingsController.updateCompany)
);

/**
 * @route POST /gapp/settings/unit
 * @description Cria uma nova unidade
 * @access GAPP_CREATE_SETTIGNS
 */
router.post('/gapp/settings/unit',
    authMiddleware,
    canAll(['GAPP_CREATE_SETTIGNS']),
    asyncHandler(gappSettingsController.createUnit)
);

/**
 * @route PUT /gapp/settings/unit/:id
 * @description Atualiza uma unidade com base no id
 * @access GAPP_UPDATE_SETTIGNS
 */
router.put('/gapp/settings/unit/:id',
    authMiddleware,
    canAll(['GAPP_UPDATE_SETTIGNS']),
    asyncHandler(gappSettingsController.updateUnit)
);

/**
 * @route POST /gapp/settings/departament
 * @description Cria um novo departamento
 * @access GAPP_CREATE_SETTIGNS
 */
router.post('/gapp/settings/departament',
    authMiddleware,
    canAll(['GAPP_CREATE_SETTIGNS']),
    asyncHandler(gappSettingsController.createDepartament)
);

/**
 * @route PUT /gapp/settings/departament/:id
 * @description Atualiza um departamento com base no id
 * @access GAPP_UPDATE_SETTIGNS
 */
router.put('/gapp/settings/departament/:id',
    authMiddleware,
    canAll(['GAPP_UPDATE_SETTIGNS']),
    asyncHandler(gappSettingsController.updateDepartament)
);

/**
 * @route POST /gapp/settings/subdepartament
 * @description Cria um novo  subdepartamento
 * @access GAPP_CREATE_SETTIGNS
 */
router.post('/gapp/settings/subdepartament',
    authMiddleware,
    canAll(['GAPP_CREATE_SETTIGNS']),
    asyncHandler(gappSettingsController.createSubdepartament)
);

/**
 * @route PUT /gapp/settings/subdepartament/:id
 * @description Atualiza um subdepartamento com base no id
 * @access GAPP_UPDATE_SETTIGNS
 */
router.put('/gapp/settings/subdepartament/:id',
    authMiddleware,
    canAll(['GAPP_UPDATE_SETTIGNS']),
    asyncHandler(gappSettingsController.updateSubdepartament)
);


// ─── GAPP — Tabelas de apoio (lookup, para dropdowns/filtros) ─────────────────
//
// Dados de referência, sem informação sensível — exigem só autenticação,
// sem permissão granular (mesmo padrão de GET /shops).
//
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @route GET /gapp/company
 * @description Lista companias (gapp_company).
 * @access Autenticado
 */
router.get('/gapp/company', authMiddleware, asyncHandler(gappLookupController.listCompany));

/**
 * @route GET /gapp/units
 * @description Lista unidades/lojas (gapp_units).
 * @access Autenticado
 */
router.get('/gapp/units', authMiddleware, asyncHandler(gappLookupController.listUnits));

/**
 * @route GET /gapp/active-class
 * @description Lista classes de ativo (gapp_active_class).
 * @access Autenticado
 */
router.get('/gapp/active-class', authMiddleware, asyncHandler(gappLookupController.listActiveClass));
/**
 * @route GET /gapp/active-type
 * @description Lista tipos de ativo (gapp_active_type).
 * @access Autenticado
 */
router.get('/gapp/active-type', authMiddleware, asyncHandler(gappLookupController.listActiveType));

/**
 * @route GET /gapp/work-group
 * @description Lista grupos de trabalho (gapp_work_group).
 * @access Autenticado
 */
router.get('/gapp/work-group', authMiddleware, asyncHandler(gappLookupController.listWorkGroup));

/**
 * @route GET /gapp/driver
 * @description Lista motoristas (gapp_driver).
 * @access Autenticado
 */
router.get('/gapp/driver', authMiddleware, asyncHandler(gappLookupController.listDriver));

/**
 * @route GET /gapp/fuel-type
 * @description Lista tipos de combustível (gapp_fuel_type).
 * @access Autenticado
 */
router.get('/gapp/fuel-type', authMiddleware, asyncHandler(gappLookupController.listFuelType));

/**
 * @route GET /gapp/user
 * @description Lista usuários do GAPP (gapp_user).
 * @access Autenticado
 */
router.get('/gapp/user', authMiddleware, asyncHandler(gappLookupController.listUser));

/**
 * @route GET /gapp/insurance-company
 * @description Lista seguradoras (gapp_insurance_company).
 * @access Autenticado
 */
router.get('/gapp/insurance-company', authMiddleware, asyncHandler(gappLookupController.listInsuranceCompany));

/**
 * @route GET /gapp/type-coverage
 * @description Lista tipos de cobertura de seguro (gapp_type_coverage).
 * @access Autenticado
 */
router.get('/gapp/type-coverage', authMiddleware, asyncHandler(gappLookupController.listTypeCoverage));

/**
 * @route GET /gapp/utilization
 * @description Lista finalidades de uso do veículo (gapp_utilization).
 * @access Autenticado
 */
router.get('/gapp/utilization', authMiddleware, asyncHandler(gappLookupController.listUtilization));

/**
 * @route GET /gapp/departments
 * @description Lista departamentos com unidade e empresa resolvidas
 * (mesmo shape do legado GLOBAL/Controller/GAPP/Departament.php?all=1).
 * @access Autenticado
 */
router.get('/gapp/departments', authMiddleware, asyncHandler(gappLookupController.listDepartments));

/**
 * @route GET /gapp/sub-departments
 * @description Lista subdepartamentos
 * @access Autenticado
 */
router.get('/gapp/subdepartments', authMiddleware, asyncHandler(gappLookupController.listSubDepartments));

/**
 * @route GET /gapp/damage-type
 * @description Lista tipos de dano (gapp_damage_type) — FK de gapp_sinister.
 * @access Autenticado
 */
router.get('/gapp/damage-type', authMiddleware, asyncHandler(gappLookupController.listDamageType));

/**
 * @route GET /gapp/infractions
 * @description Lista infrações de trânsito (gapp_infractions) — FK de gapp_fines.
 * @access Autenticado
 */
router.get('/gapp/infractions', authMiddleware, asyncHandler(gappLookupController.listInfractions));

/**
 * Suite miepp — Mídia Interna e Externa Peg Pese.
 *
 * Roteador próprio (`miepp.routes.js`) porque a suite tem três zonas de
 * autenticação distintas — sessão de usuário, token de dispositivo e URL
 * assinada — e misturá-las neste arquivo, onde toda rota começa por
 * `authMiddleware`, tornaria fácil uma rota de player nascer exigindo cookie.
 *
 * Prefixo final: `/api/v1/global/miepp/...`
 */
router.use('/miepp', mieppRoutes);

module.exports = router;
