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

const express            = require('express');
const router             = express.Router();
const authController     = require('./controllers/auth.controller');
const employeeController = require('./controllers/employee.controller');
const gippRhController   = require('./controllers/gipp-rh.controller');
const payeeController    = require('./controllers/payee.controller');
const accessController        = require('./controllers/access.controller');
const chatController          = require('./controllers/chat.controller');
const filesController         = require('./controllers/files.controller');
const gtppTaskController      = require('./controllers/gtpp-task.controller');
const gtppItemController      = require('./controllers/gtpp-task-item.controller');
const gtppResponseController  = require('./controllers/gtpp-task-item-response.controller');
const gtppTaskUserController  = require('./controllers/gtpp-task-user.controller');
const gtppScopeController     = require('./controllers/gtpp-task-scope.controller');
const gtppMessageController   = require('./controllers/gtpp-message.controller');
const gtppNotifyController    = require('./controllers/gtpp-notify.controller');
const gtppThemeController     = require('./controllers/gtpp-theme.controller');
const gtppScoreController     = require('./controllers/gtpp-score.controller');
const eppProductController    = require('./controllers/epp-product.controller');
const eppMenuController       = require('./controllers/epp-menu.controller');
const eppOrderController      = require('./controllers/epp-order.controller');
const eppLogSaleController    = require('./controllers/epp-log-sale.controller');
const eppStockController      = require('./controllers/epp-stock.controller');
const shopController          = require('./controllers/shop.controller');
const gappActiveController    = require('./controllers/gapp-active.controller');
const gappInsuranceController = require('./controllers/gapp-insurance.controller');
const gappVehicleController   = require('./controllers/gapp-vehicle.controller');
const gappLookupController    = require('./controllers/gapp-lookup.controller');
const gappExpensesController  = require('./controllers/gapp-expenses.controller');
const { upload: fileUpload }  = require('../../utils/file/file.service');
const authMiddleware     = require('../../middlewares/auth.middleware');
const upload             = require('../../middlewares/upload.middleware');
const { canAll, canAny } = require('../../middlewares/permission.middleware');
const { asyncHandler }   = require('../../middlewares/async-handler.middleware');
const { loginLimiter }   = require('../../middlewares/rate-limit.middleware');
const { validate }       = require('../../middlewares/validate.middleware');
const { loginSchema }    = require('../../schemas/auth.schema');
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
const { sendMessageSchema, markAsReadSchema }               = require('../../schemas/chat.schema');
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
    validateExpenseTypePayload
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
router.post('/login', loginLimiter, validate(loginSchema), asyncHandler(authController.globalLogin));

// ─── Colaboradores ────────────────────────────────────────────────────────────

/**
 * @route GET /employees
 * @description Lista colaboradores paginados com filtros opcionais.
 * Query params: pPage, pPageSize, pEmployeeName, pCompanyId, pShopId,
 *   pDepartmentId, pSubDepartmentId, pApplicationAccess.
 * @access Requer `VIEW_EMPLOYEES`
 */
router.get('/employees',
    authMiddleware,
    canAll(['VIEW_EMPLOYEES']),
    asyncHandler(employeeController.getEmployees));

/**
 * @route GET /users
 * @description Lista usuários paginados com enriquecimento do Protheus (empresa, filial, CC).
 * Query params: pPage, pPageSize, pName, pApplicationId, pStatus.
 * @access Requer `VIEW_EMPLOYEES`
 */
router.get('/users',
    authMiddleware,
    canAll(['VIEW_EMPLOYEES']),
    asyncHandler(employeeController.getUsers));

// ─── Foto do Colaborador ──────────────────────────────────────────────────────

/**
 * @route POST /employee/:id/photo
 * @description Faz upload da foto de um colaborador.
 * @access Público (autenticação gerenciada pelo front-end via cookie)
 */
router.post('/employee/:id/photo', upload.single("photo"), asyncHandler(employeeController.postPhotoEmployee));

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
 * @access Requer `VIEW_GIPP_RH_BENEFITS` ou `MANAGE_GIPP_RH_BENEFITS`
 */
router.get('/gipp-rh/active-compensations',
    authMiddleware,
    canAny(['VIEW_GIPP_RH_BENEFITS', 'MANAGE_GIPP_RH_BENEFITS']),
    asyncHandler(gippRhController.getActiveCompensations));

/**
 * @route POST /gipp-rh/active-compensations
 * @description Cria uma nova compensação.
 * @access Requer `CREATE_GIPP_RH_BENEFITS` ou `MANAGE_GIPP_RH_BENEFITS`
 */
router.post('/gipp-rh/active-compensations',
    authMiddleware,
    canAny(['CREATE_GIPP_RH_BENEFITS', 'MANAGE_GIPP_RH_BENEFITS']),
    validate(postCompensationSchema),
    asyncHandler(gippRhController.postCompensations));

/**
 * @route PUT /gipp-rh/active-compensations
 * @description Atualiza uma compensação existente.
 * @access Requer `EDIT_GIPP_RH_BENEFITS` ou `MANAGE_GIPP_RH_BENEFITS`
 */
router.put('/gipp-rh/active-compensations',
    authMiddleware,
    canAny(['EDIT_GIPP_RH_BENEFITS', 'MANAGE_GIPP_RH_BENEFITS']),
    validate(putCompensationSchema),
    asyncHandler(gippRhController.putCompensations));

// ─── Beneficiários ────────────────────────────────────────────────────────────

/**
 * @route GET /gipp-rh/active-beneficiaries
 * @description Lista todos os beneficiários ativos com suas compensações.
 * @access Requer `VIEW_GIPP_RH_BENEFITS` ou `MANAGE_GIPP_RH_BENEFITS`
 */
router.get('/gipp-rh/active-beneficiaries',
    authMiddleware,
    canAny(['VIEW_GIPP_RH_BENEFITS', 'MANAGE_GIPP_RH_BENEFITS']),
    asyncHandler(gippRhController.getActiveBeneficiaries));

/**
 * @route POST /gipp-rh/active-beneficiaries
 * @description Associa um colaborador a uma compensação (novo beneficiário).
 * @access Requer `CREATE_GIPP_RH_BENEFITS` ou `MANAGE_GIPP_RH_BENEFITS`
 */
router.post('/gipp-rh/active-beneficiaries',
    authMiddleware,
    canAny(['CREATE_GIPP_RH_BENEFITS', 'MANAGE_GIPP_RH_BENEFITS']),
    validate(postBeneficiarySchema),
    asyncHandler(gippRhController.postBeneficiary));

/**
 * @route PUT /gipp-rh/active-beneficiaries
 * @description Atualiza os dados de um beneficiário existente.
 * @access Requer `EDIT_GIPP_RH_BENEFITS` ou `MANAGE_GIPP_RH_BENEFITS`
 */
router.put('/gipp-rh/active-beneficiaries',
    authMiddleware,
    canAny(['EDIT_GIPP_RH_BENEFITS', 'MANAGE_GIPP_RH_BENEFITS']),
    validate(putBeneficiarySchema),
    asyncHandler(gippRhController.putBeneficiary));

// ─── Colaboradores e Event Codes ──────────────────────────────────────────────

/**
 * @route GET /gipp-rh/employees-paginated
 * @description Retorna colaboradores com paginação e filtros (nome, filial, CC, CNPJ, status).
 * @access Requer `VIEW_EMPLOYEES`
 */
router.get('/gipp-rh/employees-paginated',
    authMiddleware,
    canAll(['VIEW_EMPLOYEES']),
    asyncHandler(gippRhController.getEmployeesPaginated));

/**
 * @route GET /gipp-rh/event-codes
 * @description Lista todos os códigos de evento disponíveis para lançamento de recibos.
 * @access Requer `VIEW_EMPLOYEES`
 */
router.get('/gipp-rh/event-codes',
    authMiddleware,
    canAll(['VIEW_EMPLOYEES']),
    asyncHandler(gippRhController.getEventCodes));

// ─── Recibos de Pagamento (CRUD) ──────────────────────────────────────────────

/**
 * @route GET /gipp-rh/payment-receipt
 * @description Consulta recibos de pagamento com filtros opcionais via query string.
 * @access Requer `VIEW_PAYMENT_RECEIPT` ou `MANAGE_PAYMENT_RECEIPT`
 */
router.get('/gipp-rh/payment-receipt',
    authMiddleware,
    canAny(['VIEW_PAYMENT_RECEIPT', 'MANAGE_PAYMENT_RECEIPT']),
    asyncHandler(gippRhController.getPaymentReceipts));

/**
 * @route POST /gipp-rh/payment-receipt
 * @description Insere um novo recibo de pagamento (CLT ou prestador).
 * @access Requer `CREATE_PAYMENT_RECEIPT` ou `MANAGE_PAYMENT_RECEIPT`
 */
router.post('/gipp-rh/payment-receipt',
    authMiddleware,
    canAny(['CREATE_PAYMENT_RECEIPT', 'MANAGE_PAYMENT_RECEIPT']),
    validate(postPaymentReceiptSchema),
    asyncHandler(gippRhController.postPaymentReceipt));

/**
 * @route PUT /gipp-rh/payment-receipt
 * @description Atualiza completamente um recibo de pagamento.
 * @access Requer `EDIT_PAYMENT_RECEIPT` ou `MANAGE_PAYMENT_RECEIPT`
 */
router.put('/gipp-rh/payment-receipt',
    authMiddleware,
    canAny(['EDIT_PAYMENT_RECEIPT', 'MANAGE_PAYMENT_RECEIPT']),
    validate(putPaymentReceiptSchema),
    asyncHandler(gippRhController.putPaymentReceipt));

/**
 * @route PATCH /gipp-rh/payment-receipt
 * @description Atualiza parcialmente um recibo de pagamento.
 * Apenas os campos presentes no body (exceto `id`) são modificados.
 * @access Requer `EDIT_PAYMENT_RECEIPT` ou `MANAGE_PAYMENT_RECEIPT`
 */
router.patch('/gipp-rh/payment-receipt',
    authMiddleware,
    canAny(['EDIT_PAYMENT_RECEIPT', 'MANAGE_PAYMENT_RECEIPT']),
    validate(patchPaymentReceiptSchema),
    asyncHandler(gippRhController.patchPaymentReceipt));

// ─── Download de Recibos (PDF) ─────────────────────────────────────────────────

/**
 * @route GET /gipp-rh/receipt/:branchCode
 * @description Gera e retorna o PDF do recibo de um colaborador (CLT) ou prestador
 * para uma referência específica.
 * Query params: `reference` (YYYYMM), `employee_code` ou `payee_id`.
 * @access Requer `DOWNLOAD_RECEIPT`
 */
router.get('/gipp-rh/receipt/:branchCode',
    authMiddleware,
    canAll(['DOWNLOAD_RECEIPT']),
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
 * @access Requer `DOWNLOAD_RECEIPT`
 */
router.post('/gipp-rh/receipt-by-group',
    authMiddleware,
    canAll(['DOWNLOAD_RECEIPT']),
    asyncHandler(gippRhController.downloadReceiptByGroup));

/**
 * @route GET /gipp-rh/receipt
 * @description Retorna recibos para exibição em tela (não PDF), filtrados por
 * colaborador, filial, intervalo de referência e tipo de pagamento.
 * @access Requer `VIEW_PAYMENT_RECEIPT` ou `MANAGE_PAYMENT_RECEIPT`
 */
router.get('/gipp-rh/receipt',
    authMiddleware,
    canAny(['VIEW_PAYMENT_RECEIPT', 'MANAGE_PAYMENT_RECEIPT']),
    asyncHandler(gippRhController.getReceipt));

/**
 * @route GET /gipp-rh/payment-types
 * @description Lista todos os tipos de pagamento disponíveis.
 * @access Requer `VIEW_PAYMENT_RECEIPT` ou `MANAGE_PAYMENT_RECEIPT`
 */
router.get('/gipp-rh/payment-types',
    authMiddleware,
    canAny(['VIEW_PAYMENT_RECEIPT', 'MANAGE_PAYMENT_RECEIPT']),
    asyncHandler(gippRhController.getPaymentTypes));

// ─── Payee (Freelancers e Prestadores) ────────────────────────────────────────

/**
 * @route GET /payee
 * @description Retorna a lista de prestadores/freelancers com filtros opcionais.
 * @access Requer `VIEW_PAYEE` ou `MANAGE_PAYEE`
 */
router.get('/payee',
    authMiddleware,
    canAny(['VIEW_PAYEE', 'MANAGE_PAYEE']),
    asyncHandler(payeeController.getPayees));

/**
 * @route POST /payee
 * @description Cadastra um novo prestador/freelancer.
 * @access Requer `CREATE_PAYEE` ou `MANAGE_PAYEE`
 */
router.post('/payee',
    authMiddleware,
    canAny(['CREATE_PAYEE', 'MANAGE_PAYEE']),
    validate(postPayeeSchema),
    asyncHandler(payeeController.postPayee));

/**
 * @route PUT /payee
 * @description Atualiza completamente um prestador existente.
 * @access Requer `EDIT_PAYEE` ou `MANAGE_PAYEE`
 */
router.put('/payee',
    authMiddleware,
    canAny(['EDIT_PAYEE', 'MANAGE_PAYEE']),
    validate(putPayeeSchema),
    asyncHandler(payeeController.putPayee));

/**
 * @route PATCH /payee
 * @description Atualiza parcialmente um prestador existente.
 * @access Requer `EDIT_PAYEE` ou `MANAGE_PAYEE`
 */
router.patch('/payee',
    authMiddleware,
    canAny(['EDIT_PAYEE', 'MANAGE_PAYEE']),
    validate(patchPayeeSchema),
    asyncHandler(payeeController.patchPayee));

/**
 * @route DELETE /payee/:id
 * @description Remove um prestador, desde que não possua recibos de pagamento vinculados.
 * @access Requer `DELETE_PAYEE` ou `MANAGE_PAYEE`
 */
router.delete('/payee/:id',
    authMiddleware,
    canAny(['DELETE_PAYEE', 'MANAGE_PAYEE']),
    asyncHandler(payeeController.deletePayee));

// ─── Gestão de Acessos — Usuários ─────────────────────────────────────────────

/**
 * @route GET /access/users
 * @description Lista usuários com filtros opcionais (ad_status, nome, matrícula, filial).
 * @access Requer `VIEW_ACCESS` ou `MANAGE_ACCESS`
 */
router.get('/access/users',
    authMiddleware,
    canAny(['VIEW_ACCESS', 'MANAGE_ACCESS']),
    asyncHandler(accessController.getUsers));

/**
 * @route GET /access/users/:id
 * @description Retorna um usuário pelo ID com seus papéis e permissões expandidos.
 * @access Requer `VIEW_ACCESS` ou `MANAGE_ACCESS`
 */
router.get('/access/users/:id',
    authMiddleware,
    canAny(['VIEW_ACCESS', 'MANAGE_ACCESS']),
    asyncHandler(accessController.getUserById));

/**
 * @route POST /access/users
 * @description Cria um novo usuário com senha hasheada.
 * @access Requer `MANAGE_ACCESS`
 */
router.post('/access/users',
    authMiddleware,
    canAny(['MANAGE_ACCESS']),
    validate(postUserSchema),
    asyncHandler(accessController.postUser));

/**
 * @route PUT /access/users/:id
 * @description Atualiza completamente um usuário (sem alterar senha ou campos de AD).
 * @access Requer `MANAGE_ACCESS`
 */
router.put('/access/users/:id',
    authMiddleware,
    canAny(['MANAGE_ACCESS']),
    validate(putUserSchema),
    asyncHandler(accessController.putUser));

/**
 * @route PATCH /access/users/:id
 * @description Atualiza parcialmente um usuário. Campos inválidos são ignorados.
 * @access Requer `MANAGE_ACCESS`
 */
router.patch('/access/users/:id',
    authMiddleware,
    canAny(['MANAGE_ACCESS']),
    validate(patchUserSchema),
    asyncHandler(accessController.patchUser));

/**
 * @route DELETE /access/users/:id
 * @description Desativa um usuário (soft-delete: ad_status = 'delete'). O registro permanece no banco.
 * @access Requer `MANAGE_ACCESS`
 */
router.delete('/access/users/:id',
    authMiddleware,
    canAny(['MANAGE_ACCESS']),
    asyncHandler(accessController.deleteUser));

// ─── Gestão de Acessos — Vínculos Usuário ↔ Papel ─────────────────────────────

/**
 * @route GET /access/users/:id/roles
 * @description Retorna os papéis de um usuário.
 * @access Requer `VIEW_ACCESS` ou `MANAGE_ACCESS`
 */
router.get('/access/users/:id/roles',
    authMiddleware,
    canAny(['VIEW_ACCESS', 'MANAGE_ACCESS']),
    asyncHandler(accessController.getUserRoles));

/**
 * @route POST /access/users/:id/roles
 * @description Associa um ou mais papéis ao usuário. Body: `{ role_ids: number[] }`.
 * Papéis já vinculados são silenciosamente ignorados.
 * @access Requer `MANAGE_ACCESS`
 */
router.post('/access/users/:id/roles',
    authMiddleware,
    canAny(['MANAGE_ACCESS']),
    validate(assignRolesSchema),
    asyncHandler(accessController.assignRolesToUser));

/**
 * @route DELETE /access/users/:id/roles/:roleId
 * @description Desassocia um papel de um usuário.
 * @access Requer `MANAGE_ACCESS`
 */
router.delete('/access/users/:id/roles/:roleId',
    authMiddleware,
    canAny(['MANAGE_ACCESS']),
    asyncHandler(accessController.removeRoleFromUser));

// ─── Gestão de Acessos — Aplicações do Usuário ────────────────────────────────

/**
 * @route GET /access/users/:id/applications
 * @description Retorna as aplicações às quais o usuário tem acesso.
 * @access Requer `VIEW_ACCESS` ou `MANAGE_ACCESS`
 */
router.get('/access/users/:id/applications',
    authMiddleware,
    canAny(['VIEW_ACCESS', 'MANAGE_ACCESS']),
    asyncHandler(accessController.getUserApplications));

/**
 * @route POST /access/users/:id/applications
 * @description Concede acesso de um usuário a uma aplicação. Body: `{ application_id: number }`.
 * @access Requer `MANAGE_ACCESS`
 */
router.post('/access/users/:id/applications',
    authMiddleware,
    canAny(['MANAGE_ACCESS']),
    validate(grantApplicationSchema),
    asyncHandler(accessController.grantApplicationAccess));

/**
 * @route DELETE /access/users/:id/applications/:appId
 * @description Revoga o acesso de um usuário a uma aplicação.
 * @access Requer `MANAGE_ACCESS`
 */
router.delete('/access/users/:id/applications/:appId',
    authMiddleware,
    canAny(['MANAGE_ACCESS']),
    asyncHandler(accessController.revokeApplicationAccess));

// ─── Gestão de Acessos — Papéis (Roles) ───────────────────────────────────────

/**
 * @route GET /access/roles
 * @description Lista todos os papéis com suas permissões agregadas.
 * @access Requer `VIEW_ACCESS` ou `MANAGE_ACCESS`
 */
router.get('/access/roles',
    authMiddleware,
    canAny(['VIEW_ACCESS', 'MANAGE_ACCESS']),
    asyncHandler(accessController.getRoles));

/**
 * @route GET /access/roles/:id
 * @description Retorna um papel pelo ID com suas permissões.
 * @access Requer `VIEW_ACCESS` ou `MANAGE_ACCESS`
 */
router.get('/access/roles/:id',
    authMiddleware,
    canAny(['VIEW_ACCESS', 'MANAGE_ACCESS']),
    asyncHandler(accessController.getRoleById));

/**
 * @route POST /access/roles
 * @description Cria um novo papel. O nome é automaticamente convertido para maiúsculas.
 * @access Requer `MANAGE_ACCESS`
 */
router.post('/access/roles',
    authMiddleware,
    canAny(['MANAGE_ACCESS']),
    validate(postRoleSchema),
    asyncHandler(accessController.postRole));

/**
 * @route PUT /access/roles/:id
 * @description Atualiza nome e descrição de um papel.
 * @access Requer `MANAGE_ACCESS`
 */
router.put('/access/roles/:id',
    authMiddleware,
    canAny(['MANAGE_ACCESS']),
    validate(putRoleSchema),
    asyncHandler(accessController.putRole));

/**
 * @route DELETE /access/roles/:id
 * @description Remove um papel. Bloqueado se houver usuários vinculados (409).
 * @access Requer `MANAGE_ACCESS`
 */
router.delete('/access/roles/:id',
    authMiddleware,
    canAny(['MANAGE_ACCESS']),
    asyncHandler(accessController.deleteRole));

// ─── Gestão de Acessos — Vínculos Papel ↔ Permissão ──────────────────────────

/**
 * @route GET /access/roles/:id/permissions
 * @description Retorna as permissões de um papel.
 * @access Requer `VIEW_ACCESS` ou `MANAGE_ACCESS`
 */
router.get('/access/roles/:id/permissions',
    authMiddleware,
    canAny(['VIEW_ACCESS', 'MANAGE_ACCESS']),
    asyncHandler(accessController.getRolePermissions));

/**
 * @route POST /access/roles/:id/permissions
 * @description Associa uma ou mais permissões a um papel. Body: `{ permission_ids: number[] }`.
 * Permissões já vinculadas são silenciosamente ignoradas.
 * @access Requer `MANAGE_ACCESS`
 */
router.post('/access/roles/:id/permissions',
    authMiddleware,
    canAny(['MANAGE_ACCESS']),
    validate(assignPermissionsSchema),
    asyncHandler(accessController.assignPermissionsToRole));

/**
 * @route PUT /access/roles/:id/permissions
 * @description Substitui completamente as permissões de um papel (operação atômica).
 * Body: `{ permission_ids: number[] }`.
 * @access Requer `MANAGE_ACCESS`
 */
router.put('/access/roles/:id/permissions',
    authMiddleware,
    canAny(['MANAGE_ACCESS']),
    validate(setPermissionsSchema),
    asyncHandler(accessController.setRolePermissions));

/**
 * @route DELETE /access/roles/:id/permissions/:permissionId
 * @description Desassocia uma permissão de um papel.
 * @access Requer `MANAGE_ACCESS`
 */
router.delete('/access/roles/:id/permissions/:permissionId',
    authMiddleware,
    canAny(['MANAGE_ACCESS']),
    asyncHandler(accessController.removePermissionFromRole));

// ─── Gestão de Acessos — Permissões ───────────────────────────────────────────

/**
 * @route GET /access/permissions
 * @description Lista todas as permissões cadastradas.
 * @access Requer `VIEW_ACCESS` ou `MANAGE_ACCESS`
 */
router.get('/access/permissions',
    authMiddleware,
    canAny(['VIEW_ACCESS', 'MANAGE_ACCESS']),
    asyncHandler(accessController.getPermissions));

/**
 * @route POST /access/permissions
 * @description Cria uma nova permissão. O código é automaticamente convertido para maiúsculas.
 * @access Requer `MANAGE_ACCESS`
 */
router.post('/access/permissions',
    authMiddleware,
    canAny(['MANAGE_ACCESS']),
    validate(postPermissionSchema),
    asyncHandler(accessController.postPermission));

/**
 * @route PUT /access/permissions/:id
 * @description Atualiza código e descrição de uma permissão.
 * @access Requer `MANAGE_ACCESS`
 */
router.put('/access/permissions/:id',
    authMiddleware,
    canAny(['MANAGE_ACCESS']),
    validate(putPermissionSchema),
    asyncHandler(accessController.putPermission));

/**
 * @route DELETE /access/permissions/:id
 * @description Remove uma permissão. Bloqueado se estiver em uso por algum papel (409).
 * @access Requer `MANAGE_ACCESS`
 */
router.delete('/access/permissions/:id',
    authMiddleware,
    canAny(['MANAGE_ACCESS']),
    asyncHandler(accessController.deletePermission));

// ─── Gestão de Acessos — Aplicações ───────────────────────────────────────────

/**
 * @route GET /access/applications
 * @description Lista todas as aplicações cadastradas no sistema.
 * @access Requer `VIEW_ACCESS` ou `MANAGE_ACCESS`
 */
router.get('/access/applications',
    authMiddleware,
    canAny(['VIEW_ACCESS', 'MANAGE_ACCESS']),
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
    canAny(['USE_CLPP_CHAT']),
    asyncHandler(chatController.getConversations));

/**
 * @route GET /chat/messages
 * @description Retorna mensagens paginadas entre o usuário e um parceiro.
 * Query params: `with_user_id` (obrigatório), `page` (padrão 1).
 * @access Requer `USE_CHAT`
 */
router.get('/chat/messages',
    authMiddleware,
    canAny(['USE_CLPP_CHAT']),
    asyncHandler(chatController.getMessages));

/**
 * @route POST /chat/messages
 * @description Envia uma mensagem de texto. Body: `{ to_user_id, message, type? }`.
 * Após salvar, emite `chat:message` ao destinatário e `chat:delivered` ao remetente via WS.
 * @access Requer `USE_CHAT`
 */
router.post('/chat/messages',
    authMiddleware,
    canAny(['USE_CLPP_CHAT']),
    validate(sendMessageSchema),
    asyncHandler(chatController.sendMessage));

/**
 * @route POST /chat/messages/file
 * @description Envia um arquivo (imagem ou documento) como mensagem (multipart/form-data).
 * Campo obrigatório: `file`. Campo `to_user_id` no body.
 * Limite: 10 MB. Arquivos executáveis são bloqueados.
 * @access Requer `USE_CHAT`
 */
router.post('/chat/messages/file',
    authMiddleware,
    canAny(['USE_CLPP_CHAT']),
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
    canAny(['USE_CLPP_CHAT']),
    validate(markAsReadSchema),
    asyncHandler(chatController.markAsRead));

// ─── GTPP — Gerenciador de Tarefas Peg Pesé ──────────────────────────────────

/**
 * @route GET /gtpp/states
 * @description Lista todos os estados de tarefa disponíveis (id, description, color).
 * Equivalente ao TaskState.php do PHP.
 * @access Requer `USE_GTPP`
 */
router.get('/gtpp/states',
    authMiddleware,
    canAny(['USE_GTPP']),
    asyncHandler(gtppTaskController.getTaskStates));

/**
 * @route GET /gtpp/tasks
 * @description Lista tarefas onde o usuário é criador ou está vinculado.
 * @access Requer `USE_GTPP`
 */
router.get('/gtpp/tasks',
    authMiddleware,
    canAny(['USE_GTPP']),
    asyncHandler(gtppTaskController.getTasks));

/**
 * @route GET /gtpp/tasks/board
 * @description Retorna tarefas de múltiplos estados em uma única requisição.
 * Query params: state_ids (csv), page, limit.
 * @access Requer `USE_GTPP`
 */
router.get('/gtpp/tasks/board',
    authMiddleware,
    canAny(['USE_GTPP']),
    asyncHandler(gtppTaskController.getTasksBoard));

/**
 * @route GET /gtpp/tasks/:taskId/historic
 * @description Lista o histórico de mudanças de estado de uma tarefa.
 * @access Requer `USE_GTPP`
 */
router.get('/gtpp/tasks/:taskId/historic',
    authMiddleware,
    canAny(['USE_GTPP']),
    asyncHandler(gtppTaskController.getTaskHistoric));

/**
 * @route GET /gtpp/tasks/:id
 * @description Retorna uma tarefa completa com itens e usuários vinculados.
 * @access Requer `USE_GTPP`
 */
router.get('/gtpp/tasks/:id',
    authMiddleware,
    canAny(['USE_GTPP']),
    asyncHandler(gtppTaskController.getTaskById));

/**
 * @route POST /gtpp/tasks
 * @description Cria uma nova tarefa. Body: { title, description?, theme_id?, expire_day? }
 * @access Requer `USE_GTPP`
 */
router.post('/gtpp/tasks',
    authMiddleware,
    canAny(['USE_GTPP']),
    validate(postTaskSchema),
    asyncHandler(gtppTaskController.createTask));

/**
 * @route PUT /gtpp/tasks/:id/state
 * @description Atualiza o estado de uma tarefa. Body: { state_id, description? }
 * @access Requer `USE_GTPP` (apenas criador ou MANAGE_GTPP)
 */
router.put('/gtpp/tasks/:id/state',
    authMiddleware,
    canAny(['USE_GTPP']),
    validate(putTaskStateSchema),
    asyncHandler(gtppTaskController.updateTaskState));

/**
 * @route PUT /gtpp/tasks/:id/title
 * @description Atualiza o título de uma tarefa. Body: { description }
 * @access Requer `USE_GTPP` (apenas criador ou MANAGE_GTPP)
 */
router.put('/gtpp/tasks/:id/title',
    authMiddleware,
    canAny(['USE_GTPP']),
    validate(putTaskTitleSchema),
    asyncHandler(gtppTaskController.updateTaskTitle));

/**
 * @route PUT /gtpp/tasks/:id/description
 * @description Atualiza a descrição longa de uma tarefa. Body: { full_description }
 * @access Requer `USE_GTPP` (apenas criador ou MANAGE_GTPP)
 */
router.put('/gtpp/tasks/:id/description',
    authMiddleware,
    canAny(['USE_GTPP']),
    validate(putTaskDescriptionSchema),
    asyncHandler(gtppTaskController.updateTaskDescription));

/**
 * @route PUT /gtpp/tasks/:id/theme
 * @description Atualiza o tema de uma tarefa. Body: { theme_id }
 * @access Requer `USE_GTPP` (apenas criador ou MANAGE_GTPP)
 */
router.put('/gtpp/tasks/:id/theme',
    authMiddleware,
    canAny(['USE_GTPP']),
    validate(putTaskThemeSchema),
    asyncHandler(gtppTaskController.updateTaskTheme));

/**
 * @route DELETE /gtpp/tasks/:id
 * @description Remove uma tarefa permanentemente.
 * @access Requer `USE_GTPP` (apenas criador ou MANAGE_GTPP)
 */
router.delete('/gtpp/tasks/:id',
    authMiddleware,
    canAny(['USE_GTPP']),
    asyncHandler(gtppTaskController.deleteTask));

// ─── GTPP — Itens de Tarefa ───────────────────────────────────────────────────

/**
 * @route GET /gtpp/tasks/:taskId/items
 * @description Lista itens ativos de uma tarefa.
 * @access Requer `USE_GTPP`
 */
router.get('/gtpp/tasks/:taskId/items',
    authMiddleware,
    canAny(['USE_GTPP']),
    asyncHandler(gtppItemController.getTaskItems));

/**
 * @route POST /gtpp/tasks/:taskId/items
 * @description Cria um item na tarefa. Campo `file` opcional (multipart/form-data).
 * @access Requer `USE_GTPP`
 */
router.post('/gtpp/tasks/:taskId/items',
    authMiddleware,
    canAny(['USE_GTPP']),
    fileUpload.single('file'),
    validate(postTaskItemSchema),
    asyncHandler(gtppItemController.createTaskItem));

/**
 * @route PUT /gtpp/tasks/:taskId/items/:id
 * @description Atualiza um campo do item. Body: { action, ...campos }.
 * Actions: check | yes_no | description | file | note | assigned_to | status | position
 * @access Requer `USE_GTPP`
 */
router.put('/gtpp/tasks/:taskId/items/:id',
    authMiddleware,
    canAny(['USE_GTPP']),
    fileUpload.single('file'),
    validate(putTaskItemSchema),
    asyncHandler(gtppItemController.updateTaskItem));

/**
 * @route GET /gtpp/tasks/:taskId/items/:id/file
 * @description Serve o arquivo anexado ao item.
 *              Transparente: abstrai arquivo novo (_files) e legado (BLOB).
 * @access Requer `USE_GTPP`
 */
router.get('/gtpp/tasks/:taskId/items/:id/file',
    authMiddleware,
    canAny(['USE_GTPP']),
    asyncHandler(gtppItemController.downloadItemFile));

/**
 * @route DELETE /gtpp/tasks/:taskId/items/:id
 * @description Soft-delete de um item (status = 0).
 * @access Requer `USE_GTPP`
 */
router.delete('/gtpp/tasks/:taskId/items/:id',
    authMiddleware,
    canAny(['USE_GTPP']),
    asyncHandler(gtppItemController.deleteTaskItem));

// ─── GTPP — Respostas / Evidências ───────────────────────────────────────────

/**
 * @route GET /gtpp/items/:itemId/responses
 * @description Lista respostas ativas de um item de tarefa.
 * @access Requer `USE_GTPP`
 */
router.get('/gtpp/items/:itemId/responses',
    authMiddleware,
    canAny(['USE_GTPP']),
    asyncHandler(gtppResponseController.getItemResponses));

/**
 * @route POST /gtpp/items/:itemId/responses
 * @description Adiciona uma resposta/evidência a um item. Campo `file` opcional.
 * Body: { comment, last_state_id?, new_state_id? }
 * @access Requer `USE_GTPP`
 */
router.post('/gtpp/items/:itemId/responses',
    authMiddleware,
    canAny(['USE_GTPP']),
    fileUpload.single('file'),
    asyncHandler(gtppResponseController.createItemResponse));

/**
 * @route PUT /gtpp/items/:itemId/responses/:id
 * @description Atualiza o comentário de uma resposta.
 * Body: { comment }
 * @access Requer `USE_GTPP`
 */
router.put('/gtpp/items/:itemId/responses/:id',
    authMiddleware,
    canAny(['USE_GTPP']),
    validate(putTaskItemResponseSchema),
    asyncHandler(gtppResponseController.updateItemResponse));

/**
 * @route DELETE /gtpp/items/:itemId/responses/:id
 * @description Soft-delete de uma resposta (status = 0).
 * @access Requer `USE_GTPP`
 */
router.delete('/gtpp/items/:itemId/responses/:id',
    authMiddleware,
    canAny(['USE_GTPP']),
    asyncHandler(gtppResponseController.deleteItemResponse));

// ─── GTPP — Escopo da Tarefa ──────────────────────────────────────────────────

/**
 * @route GET /gtpp/tasks/:taskId/scope
 * @description Lista os escopos (companhia/loja/CC) vinculados à tarefa.
 * @access Requer `USE_GTPP`
 */
router.get('/gtpp/tasks/:taskId/scope',
    authMiddleware,
    canAny(['USE_GTPP']),
    asyncHandler(gtppScopeController.getTaskScope));

/**
 * @route POST /gtpp/tasks/:taskId/scope
 * @description Adiciona um escopo à tarefa. Body: { company_code?, branch_code?, cost_center_code? }
 * @access Requer `USE_GTPP`
 */
router.post('/gtpp/tasks/:taskId/scope',
    authMiddleware,
    canAny(['USE_GTPP']),
    validate(postTaskScopeSchema),
    asyncHandler(gtppScopeController.addTaskScope));

/**
 * @route DELETE /gtpp/tasks/:taskId/scope/:id
 * @description Remove um escopo da tarefa.
 * @access Requer `USE_GTPP`
 */
router.delete('/gtpp/tasks/:taskId/scope/:id',
    authMiddleware,
    canAny(['USE_GTPP']),
    asyncHandler(gtppScopeController.removeTaskScope));

// ─── GTPP — Usuários da Tarefa ────────────────────────────────────────────────

/**
 * @route GET /gtpp/tasks/:taskId/users
 * @description Lista usuários com acesso GTPP, indicando vinculação à tarefa.
 * @access Requer `USE_GTPP`
 */
router.get('/gtpp/tasks/:taskId/users',
    authMiddleware,
    canAny(['USE_GTPP']),
    asyncHandler(gtppTaskUserController.getTaskUsers));

/**
 * @route PUT /gtpp/tasks/:taskId/users
 * @description Alterna vínculo de usuário à tarefa. Body: { user_id }
 * @access Requer `USE_GTPP` (apenas criador ou MANAGE_GTPP)
 */
router.put('/gtpp/tasks/:taskId/users',
    authMiddleware,
    canAny(['USE_GTPP']),
    validate(putTaskUserSchema),
    asyncHandler(gtppTaskUserController.toggleTaskUser));

// ─── GTPP — Mensagens (chat da tarefa) ────────────────────────────────────────

/**
 * @route GET /gtpp/tasks/:taskId/messages
 * @description Lista mensagens de uma tarefa.
 * @access Requer `USE_GTPP`
 */
router.get('/gtpp/tasks/:taskId/messages',
    authMiddleware,
    canAny(['USE_GTPP']),
    asyncHandler(gtppMessageController.getTaskMessages));

/**
 * @route POST /gtpp/tasks/:taskId/messages
 * @description Envia uma mensagem. Campo `file` opcional (multipart/form-data).
 * Body: { description? } + campo file opcional.
 * @access Requer `USE_GTPP`
 */
router.post('/gtpp/tasks/:taskId/messages',
    authMiddleware,
    canAny(['USE_GTPP']),
    fileUpload.single('file'),
    validate(postTaskMessageSchema),
    asyncHandler(gtppMessageController.sendMessage));

/**
 * @route DELETE /gtpp/messages/:id
 * @description Remove uma mensagem. Query param: task_id (obrigatório).
 * @access Requer `USE_GTPP`
 */
router.delete('/gtpp/messages/:id',
    authMiddleware,
    canAny(['USE_GTPP']),
    asyncHandler(gtppMessageController.deleteMessage));

// ─── GTPP — Notificações ──────────────────────────────────────────────────────

/**
 * @route GET /gtpp/notifications
 * @description Retorna e consome (deleta) notificações pendentes do usuário.
 * @access Requer `USE_GTPP`
 */
router.get('/gtpp/notifications',
    authMiddleware,
    canAny(['USE_GTPP']),
    asyncHandler(gtppNotifyController.getNotifications));

// ─── GTPP — Temas ─────────────────────────────────────────────────────────────

/**
 * @route GET /gtpp/themes
 * @description Lista temas. Params: ?all=true | ?id=X | (padrão) temas do usuário.
 * @access Requer `USE_GTPP`
 */
router.get('/gtpp/themes',
    authMiddleware,
    canAny(['USE_GTPP']),
    asyncHandler(gtppThemeController.getThemes));

/**
 * @route POST /gtpp/themes
 * @description Cria um novo tema. Body: { description_theme }
 * @access Requer `USE_GTPP`
 */
router.post('/gtpp/themes',
    authMiddleware,
    canAny(['USE_GTPP']),
    validate(postThemeSchema),
    asyncHandler(gtppThemeController.createTheme));

/**
 * @route PUT /gtpp/themes/:id
 * @description Atualiza a descrição de um tema. Body: { description_theme }
 * @access Requer `USE_GTPP`
 */
router.put('/gtpp/themes/:id',
    authMiddleware,
    canAny(['USE_GTPP']),
    validate(putThemeSchema),
    asyncHandler(gtppThemeController.updateTheme));

/**
 * @route DELETE /gtpp/themes/:id
 * @description Remove um tema permanentemente.
 * @access Requer `USE_GTPP`
 */
router.delete('/gtpp/themes/:id',
    authMiddleware,
    canAny(['USE_GTPP']),
    asyncHandler(gtppThemeController.deleteTheme));

// ─── GTPP — Pontuação ─────────────────────────────────────────────────────────

/**
 * @route GET /gtpp/score
 * @description Pontuação: ?all=no (usuário atual), ?all=yes (todos), ?task_id=X (disqualify).
 * @access Requer `USE_GTPP`
 */
router.get('/gtpp/score',
    authMiddleware,
    canAny(['USE_GTPP']),
    asyncHandler(gtppScoreController.getScore));

/**
 * @route PUT /gtpp/score/disqualify
 * @description Atualiza desqualificação de tarefa. Query: task_id, disqualify (0|1).
 * @access Requer `MANAGE_GTPP`
 */
router.put('/gtpp/score/disqualify',
    authMiddleware,
    canAny(['MANAGE_GTPP']),
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
//  USE_EPP        → Leitura geral (produtos, menus, categorias, estoque)
//  EPP_ORDERS     → Ver, criar e atualizar pedidos e seus itens de venda
//  EPP_PRODUCTS   → Cadastrar e editar produtos, menus e log_menus
//  EPP_RECEIPE    → Acessar receitas técnicas Oracle (mobile, oracle_receipe)
//  EPP_MANAGE     → Administração total (exclusões, correções de estoque)
//
// ─────────────────────────────────────────────────────────────────────────────

// ─── EPP — Produtos ───────────────────────────────────────────────────────────

/**
 * @route GET /epp/products
 * @description Lista produtos.
 * Query: ?complete=1 (todos) | ?category=1 (categorias) |
 *        ?id_product=X | ?id_category_fk=X | ?status_prod=X (filtros)
 * @access USE_EPP | EPP_ORDERS | EPP_PRODUCTS | EPP_RECEIPE
 */
router.get('/epp/products',
    authMiddleware,
    canAny(['USE_EPP', 'EPP_ORDERS', 'EPP_PRODUCTS', 'EPP_RECEIPE']),
    asyncHandler(eppProductController.getProducts));

/**
 * @route GET /epp/products/consinco
 * @description Consulta produto no ERP Consinco (Oracle) por código de barras.
 * Query: codigo_acesso (obrigatório), lojas (obrigatório), full_store?
 * @access USE_EPP | EPP_ORDERS | EPP_PRODUCTS
 */
router.get('/epp/products/consinco',
    authMiddleware,
    canAny(['USE_EPP', 'EPP_ORDERS', 'EPP_PRODUCTS']),
    asyncHandler(eppProductController.getProductConsinco));

/**
 * @route GET /epp/products/:id
 * @description Retorna um produto pelo ID com nome da categoria.
 * @access USE_EPP | EPP_ORDERS | EPP_PRODUCTS | EPP_RECEIPE
 */
router.get('/epp/products/:id',
    authMiddleware,
    canAny(['USE_EPP', 'EPP_ORDERS', 'EPP_PRODUCTS', 'EPP_RECEIPE']),
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
 * @access USE_EPP | EPP_ORDERS | EPP_PRODUCTS | EPP_RECEIPE
 */
router.get('/epp/menus',
    authMiddleware,
    canAny(['USE_EPP', 'EPP_ORDERS', 'EPP_PRODUCTS', 'EPP_RECEIPE']),
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
 * @access USE_EPP | EPP_ORDERS | EPP_PRODUCTS | EPP_RECEIPE
 */
router.get('/epp/log-menus',
    authMiddleware,
    canAny(['USE_EPP', 'EPP_ORDERS', 'EPP_PRODUCTS', 'EPP_RECEIPE']),
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
    canAny(['EPP_ECOMMERCE', 'EPP_MANAGE']),
    asyncHandler(eppOrderController.getEcommerceOrder));

/**
 * @route POST /epp/orders/consinco/:nroPedido/ecommerce
 * @description Confirma pedido do ecommerce: insere apenas itens cadastrados, retorna warnings para os demais.
 * Body: { delivery_date, delivery_hour, delivery_store }
 * @access EPP_ORDERS | EPP_MANAGE
 */
router.post('/epp/orders/consinco/:nroPedido/ecommerce',
    authMiddleware,
    canAny(['EPP_ECOMMERCE', 'EPP_MANAGE']),
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
 * @access EPP_ORDERS (itens de pedido) | EPP_RECEIPE (mobile + receita Oracle) | EPP_MANAGE
 */
router.get('/epp/log-sales',
    authMiddleware,
    canAny(['EPP_ORDERS', 'EPP_RECEIPE', 'EPP_MANAGE']),
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
 * @access USE_EPP | EPP_ORDERS | EPP_RECEIPE | EPP_MANAGE
 */
router.get('/epp/stock',
    authMiddleware,
    canAny(['USE_EPP', 'EPP_ORDERS', 'EPP_RECEIPE', 'EPP_MANAGE']),
    asyncHandler(eppStockController.getStock));

/**
 * @route POST /epp/stock
 * @description Registra entrada (qty > 0) ou saída (qty < 0) de estoque.
 * Body: { id_product_fk, stock_quantity, created_by, updated_by, measure }
 * @access USE_EPP | EPP_ORDERS | EPP_MANAGE
 */
router.post('/epp/stock',
    authMiddleware,
    canAny(['USE_EPP', 'EPP_ORDERS', 'EPP_MANAGE']),
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
// `vehicle_id_fk` via `sp_gapp_save_insurance` (mesmos workers da rota acima).
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route POST /gapp/insurance
 * @description Cria o seguro de um veículo (`vehicle_id_fk` obrigatório).
 * @access Requer `GAPP_CREATE_INSURANCE`
 */
router.post('/gapp/insurance',
    authMiddleware,
    canAll(['GAPP_CREATE_INSURANCE']),
    validate(createInsuranceSchema),
    asyncHandler(gappInsuranceController.createInsurance));

/**
 * @route PUT /gapp/insurance
 * @description Atualiza o seguro de um veículo (`vehicle_id_fk` obrigatório).
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
 * Use `vehicle_id_fk` para ver todo o histórico de apólices de um veículo.
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

// ─── GAPP — Despesas de Ativo ───────────────────────────────────────────────

/**
 * @route GET /gapp/expenses
 * @description Lista/filtra despesas de qualquer ativo, com paginação.
 * Restrito ao work_group_fk do usuário autenticado.
 * @access Requer `GAPP_VIEW_EXPENSES`
 */
router.get('/gapp/expenses',
    authMiddleware,
    canAll(['GAPP_VIEW_EXPENSES']),
    validate(listExpensesQuerySchema, 'query'),
    asyncHandler(gappExpensesController.listExpenses));

/**
 * @route GET /gapp/expenses/vehicles
 * @description Lista/filtra despesas restritas a ativos que são veículo —
 * permite filtrar por placa (`license_plates`) e unidade. Baseada na
 * pcr_select_filtered_expenses (legado), com isolamento por work_group_fk.
 * @access Requer `GAPP_VIEW_EXPENSES`
 */
router.get('/gapp/expenses/vehicles',
    authMiddleware,
    canAll(['GAPP_VIEW_EXPENSES']),
    validate(listVehicleExpensesQuerySchema, 'query'),
    asyncHandler(gappExpensesController.listVehicleExpenses));

/**
 * @route GET /gapp/expenses/:id
 * @description Retorna uma despesa com o detalhe do tipo aninhado
 * (`fuel`/`maintenance`/`sinister`/`fine`/`insurance` — o que não for do
 * tipo vem `null`). Restrito ao work_group_fk do usuário.
 * @access Requer `GAPP_VIEW_EXPENSES`
 */
router.get('/gapp/expenses/:id',
    authMiddleware,
    canAll(['GAPP_VIEW_EXPENSES']),
    asyncHandler(gappExpensesController.getExpenseById));

/**
 * @route POST /gapp/expenses
 * @description Cria uma despesa. `user_id_fk` é sempre resolvido do usuário
 * autenticado. Se `active_id_fk` vier, precisa pertencer ao work_group_fk
 * do usuário. O objeto de detalhe exigido depende de `exp_type_id_fk`
 * (1=fuel, 2=maintenance, 3=sinister, 4=fine, 5=insurance; 6=Outros não
 * exige nenhum) — tudo gravado numa única transação.
 * @access Requer `GAPP_CREATE_EXPENSES`
 */
router.post('/gapp/expenses',
    authMiddleware,
    canAll(['GAPP_CREATE_EXPENSES']),
    validate(createExpenseSchema),
    validateExpenseTypePayload,
    asyncHandler(gappExpensesController.createExpense));

/**
 * @route PUT /gapp/expenses/:id
 * @description Atualiza uma despesa existente e seu detalhe (mesma regra
 * de objeto por tipo do create). fuel/maintenance/sinister/fine são
 * substituídos por completo; Seguro é atualizado in-place (nunca recriado).
 * @access Requer `GAPP_UPDATE_EXPENSES`
 */
router.put('/gapp/expenses/:id',
    authMiddleware,
    canAll(['GAPP_UPDATE_EXPENSES']),
    validate(updateExpenseSchema),
    validateExpenseTypePayload,
    asyncHandler(gappExpensesController.updateExpense));

// ─── GAPP — Tabelas de apoio (lookup, para dropdowns/filtros) ──────────────────
//
// Dados de referência, sem informação sensível — exigem só autenticação,
// sem permissão granular (mesmo padrão de GET /shops).
//
// ─────────────────────────────────────────────────────────────────────────────

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

module.exports = router;
