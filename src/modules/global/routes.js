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
const accessController   = require('./controllers/access.controller');
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
 * @description Lista usuários com filtros opcionais (status, nome, matrícula, filial).
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
 * @description Desativa um usuário (soft-delete: status = 0). O registro permanece no banco.
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

module.exports = router;
