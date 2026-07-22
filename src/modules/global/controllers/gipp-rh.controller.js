/**
 * @fileoverview Controller de RH do GIPP.
 *
 * Camada de entrada HTTP para todas as operações relacionadas a compensações,
 * beneficiários, colaboradores paginados, recibos de pagamento e geração de PDF.
 * Cada função delega a lógica de negócio para `GippRhService` e retorna a resposta
 * HTTP adequada.
 *
 * @module modules/global/controllers/gipp-rh.controller
 */

const { GippRhService }    = require("../services/gipp-rh.service");
const { generateReceipt }  = require("../../../templates/receipt/receipt.generator");
const { BadRequestError }  = require('../../../errors/bad-request.error');
const { AppError }         = require('../../../errors/app.error');
const { respond }          = require('../../../utils/respond');

// ─── Compensações ─────────────────────────────────────────────────────────────

/**
 * Retorna todas as compensações ativas.
 *
 * @route GET /gipp-rh/active-compensations
 * @param {import('express').Request}  req - Requisição Express.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a lista de compensações em `data`.
 */
async function getActiveCompensations(req, res) {
    const employee     = new GippRhService();
    const compensations = await employee.getActiveCompensations();
    return res.status(200).json({
        error: false,
        data:  compensations
    });
}

/**
 * Cria uma nova compensação.
 *
 * Extrai os dados do `body` e preenche os campos de auditoria (`created_by` e
 * `created_by_branch`) a partir do token do usuário autenticado.
 *
 * @route POST /gipp-rh/active-compensations
 * @param {import('express').Request}  req          - Requisição com `user` e `body`.
 * @param {import('express').Response} res          - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a compensação criada.
 */
async function postCompensations(req, res) {
    const { user, body } = req;
    const employee       = new GippRhService();

    const payload = {
        name:              body.name,
        description:       body.description,
        active:            body.active,
        created_by:        user.registration,
        created_by_branch: user.branch_code
    };

    const compensations = await employee.postCompensations(payload);
    return respond.ok(res, compensations);
}

// ─── Beneficiários ─────────────────────────────────────────────────────────────

/**
 * Associa um colaborador a uma compensação (cria beneficiário).
 *
 * @route POST /gipp-rh/active-beneficiaries
 * @param {import('express').Request}  req - Requisição com `user` e `body`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com o beneficiário criado.
 */
async function postBeneficiary(req, res) {
    const { user, body } = req;
    const employee       = new GippRhService();

    const payload = {
        employee_id:     body.employee_id,
        compensation_id: body.compensation_id,
        value:           body.value,
        branch_code:     body.branch_code,
        start_date:      body.start_date,
        created_by:      user.registration,
        updated_by:      user.registration
    };

    const beneficiary = await employee.postBeneficiary(payload);
    return respond.ok(res, beneficiary);
}

/**
 * Atualiza os dados de um beneficiário existente.
 *
 * @route PUT /gipp-rh/active-beneficiaries
 * @param {import('express').Request}  req - Requisição com `user` e `body`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com o beneficiário atualizado.
 */
async function putBeneficiary(req, res) {
    const { user, body } = req;
    const employee       = new GippRhService();

    const payload = {
        id:              body.id,
        employee_id:     body.employee_id,
        compensation_id: body.compensation_id,
        value:           body.value,
        branch_code:     body.branch_code,
        start_date:      body.start_date,
        created_by:      user.registration,
        updated_by:      user.registration
    };

    const beneficiary = await employee.putBeneficiary(payload);
    return respond.ok(res, beneficiary);
}

/**
 * Atualiza uma compensação existente.
 *
 * @route PUT /gipp-rh/active-compensations
 * @param {import('express').Request}  req - Requisição com `user` e `body`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a compensação atualizada em `data`.
 */
async function putCompensations(req, res) {
    const { user, body } = req;
    const employee       = new GippRhService();

    const payload = {
        id:          body.id,
        name:        body.name,
        description: body.description,
        active:      body.active,
        user_code:   user.registration,
        branch_code: user.branch_code
    };

    const compensations = await employee.putCompensations(payload);
    return res.status(200).json({
        error: false,
        data:  compensations
    });
}

/**
 * Retorna todos os beneficiários ativos com suas compensações.
 *
 * @route GET /gipp-rh/active-beneficiaries
 * @param {import('express').Request}  req - Requisição Express.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a lista de beneficiários em `data`.
 */
async function getActiveBeneficiaries(req, res) {
    const employee      = new GippRhService();
    const compensations = await employee.getActiveBeneficiaries();
    return res.status(200).json({
        error: false,
        data:  compensations
    });
}

// ─── Colaboradores ─────────────────────────────────────────────────────────────

/**
 * Retorna colaboradores com paginação e filtros opcionais.
 *
 * Parâmetros de query: `page`, `pageSize`, `name`, `costCenter`, `branch`, `cnpj`, `status`.
 *
 * @route GET /gipp-rh/employees-paginated
 * @param {import('express').Request}  req - Requisição com query params.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a lista paginada de colaboradores.
 */
async function getEmployeesPaginated(req, res) {
    const employee = new GippRhService();

    const filters = {
        page:       Number(req.query.page),
        pageSize:   Number(req.query.pageSize),
        name:       req.query.name,
        costCenter: req.query.costCenter,
        branch:     req.query.branch,
        cnpj:       req.query.cnpj,
        status:     req.query.status
    };

    const data = await employee.getEmployeesPaginated(filters);
    return respond.ok(res, data);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Formata um objeto `Date` no padrão `YYYYMM`.
 *
 * @param {Date} [date=new Date()] - Data a formatar (padrão: data atual).
 * @returns {string} String no formato `YYYYMM`, ex.: `"202506"`.
 */
function formatYYYYMM(date = new Date()) {
    const year  = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${year}${month}`;
}

// ─── Download de Recibos (PDF) ─────────────────────────────────────────────────

/**
 * Gera e retorna o PDF do recibo de um colaborador (CLT) ou prestador para uma
 * referência específica.
 *
 * Parâmetros de rota: `branchCode`.
 * Parâmetros de query: `reference` (YYYYMM), `employee_code` ou `payee_id`.
 *
 * @route GET /gipp-rh/receipt/:branchCode
 * @param {import('express').Request}  req  - Requisição Express.
 * @param {import('express').Response} res  - Resposta Express.
 * @param {import('express').NextFunction} next - Próximo middleware para tratamento de erros.
 * @returns {Promise<void>} Buffer PDF como `application/pdf` com header `Content-Disposition`.
 */
async function downloadReceipt(req, res, next) {
    const { branchCode }                     = req.params;
    const { reference, employee_code, payee_id } = req.query;

    try {
        if (!employee_code && !payee_id) {
            throw new BadRequestError("Provide 'employee_code' or 'payee_id'.");
        }

        const service    = new GippRhService();
        const dataFromDB = await service.getReceiptData(
            employee_code || null,
            branchCode,
            reference,
            reference,
            payee_id ? Number(payee_id) : null
        );

        const identifier = employee_code || `payee-${payee_id}`;
        const pdf        = await generateReceipt(dataFromDB);
        const yyyymm     = formatYYYYMM();
        const fileName   = `receipt-${yyyymm}-${identifier}.pdf`;

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
        res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
        res.send(Buffer.from(pdf));
    } catch (err) {
        next(err);
    }
}

/**
 * Gera e retorna um PDF consolidado contendo todos os recibos dos grupos informados.
 *
 * Aceita um array de `receipt_group_id` (UUIDs) no body. Cada UUID corresponde a
 * uma jornada fechada; todos os itens de cada grupo são agrupados no mesmo recibo.
 *
 * @route POST /gipp-rh/receipt-by-group
 * @param {import('express').Request}  req  - Requisição com `body.receipt_group_ids`.
 * @param {import('express').Response} res  - Resposta Express.
 * @param {import('express').NextFunction} next - Próximo middleware para erros.
 * @returns {Promise<void>} Buffer PDF como `application/pdf`.
 */
async function downloadReceiptByGroup(req, res, next) {
    const { receipt_group_ids } = req.body;

    try {
        if (!receipt_group_ids?.length) {
            throw new BadRequestError("Provide at least one 'receipt_group_id'.");
        }

        const service    = new GippRhService();
        const dataFromDB = await service.getReceiptsByGroupIds(receipt_group_ids);

        if (!dataFromDB?.length) {
            throw new AppError("No receipts found for the provided receipt_group_ids.", 404);
        }

        const pdf      = await generateReceipt(dataFromDB);
        const yyyymm   = formatYYYYMM();
        const fileName = `receipts-${yyyymm}.pdf`;

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
        res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
        res.send(Buffer.from(pdf));
    } catch (err) {
        next(err);
    }
}

// ─── Event Codes ───────────────────────────────────────────────────────────────

/**
 * Retorna todos os códigos de evento disponíveis para lançamento de recibos.
 *
 * @route GET /gipp-rh/event-codes
 * @param {import('express').Request}  req - Requisição Express.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a lista de event codes.
 */
async function getEventCodes(req, res) {
    const service = new GippRhService();
    const data    = await service.getEventCodes();
    return respond.ok(res, data);
}

// ─── Recibos de Pagamento (CRUD) ───────────────────────────────────────────────

/**
 * Insere um novo recibo de pagamento.
 *
 * Os campos de auditoria (`created_by` e `created_by_branch_code`) são preenchidos
 * automaticamente a partir do token do usuário autenticado.
 *
 * @route POST /gipp-rh/payment-receipt
 * @param {import('express').Request}  req - Requisição com `user` e `body`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `201 Created` com o recibo inserido.
 */
async function postPaymentReceipt(req, res) {
    const { user, body } = req;
    const service        = new GippRhService();

    const payload = {
        company_code:           body.company_code,
        branch_code:            body.branch_code,
        employee_code:          body.employee_code         ?? null,
        payee_id:               body.payee_id              ?? null,
        employee_name:          body.employee_name,
        branch_name:            body.branch_name,
        work_schedule_id:       body.work_schedule_id,
        reference:              body.reference,
        reference_date:         body.reference_date         ?? null,
        description:            body.description,
        amount:                 body.amount,
        movement_type:          body.movement_type,
        is_active:              body.is_active,
        receipt_group_id:       body.receipt_group_id,
        event_code:             body.event_code,
        payment_type_id:        body.payment_type_id,
        created_by:             user.registration,
        created_by_branch_code: user.branch_code
    };

    const receipt = await service.postPaymentReceipt(payload);
    return respond.created(res, receipt);
}

/**
 * Consulta recibos de pagamento com filtros opcionais via query string.
 *
 * Os parâmetros chegam como string e são convertidos para os tipos adequados antes
 * de serem repassados ao serviço.
 *
 * Query params aceitos: `id`, `employee_code`, `branch_code`, `reference`,
 * `description`, `amount`, `movement_type`, `is_active`, `payment_type_id`,
 * `work_schedule_id`.
 *
 * @route GET /gipp-rh/payment-receipt
 * @param {import('express').Request}  req - Requisição com query params.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a lista de recibos.
 */
async function getPaymentReceipts(req, res) {
    const q       = req.query;
    const filters = {};

    if (q.id               !== undefined) filters.id               = Number(q.id);
    if (q.employee_code    !== undefined) filters.employee_code    = q.employee_code;
    if (q.branch_code      !== undefined) filters.branch_code      = q.branch_code;
    if (q.reference        !== undefined) filters.reference        = q.reference;
    if (q.description      !== undefined) filters.description      = q.description;
    if (q.amount           !== undefined) filters.amount           = Number(q.amount);
    if (q.movement_type    !== undefined) filters.movement_type    = q.movement_type;
    if (q.is_active        !== undefined) filters.is_active        = q.is_active === 'true' ? 1 : 0;
    if (q.payment_type_id  !== undefined) filters.payment_type_id  = Number(q.payment_type_id);
    if (q.work_schedule_id !== undefined) filters.work_schedule_id = q.work_schedule_id;
    if (q.reference_date   !== undefined) filters.reference_date   = q.reference_date;
    if (q.date_from        !== undefined) filters.date_from        = q.date_from;
    if (q.date_to          !== undefined) filters.date_to          = q.date_to;

    const service = new GippRhService();
    const data    = await service.getPaymentReceipts(filters);
    return respond.ok(res, data);
}

/**
 * Atualiza completamente um recibo de pagamento (PUT).
 *
 * Todos os campos editáveis devem ser fornecidos no body.
 *
 * @route PUT /gipp-rh/payment-receipt
 * @param {import('express').Request}  req - Requisição com `user` e `body`.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com o recibo atualizado.
 */
async function putPaymentReceipt(req, res) {
    const { user, body } = req;
    const service        = new GippRhService();

    const payload = {
        id:                     body.id,
        description:            body.description,
        amount:                 body.amount,
        movement_type:          body.movement_type,
        is_active:              body.is_active,
        reference_date:         body.reference_date ?? null,
        event_code:             body.event_code,
        work_schedule_id:       body.work_schedule_id,
        payment_type_id:        body.payment_type_id,
        updated_by:             user.registration,
        updated_by_branch_code: user.branch_code
    };

    const receipt = await service.putPaymentReceipt(payload);
    return respond.ok(res, receipt);
}

/**
 * Atualiza parcialmente um recibo de pagamento (PATCH).
 *
 * Apenas os campos presentes no `body` (exceto `id`) serão alterados.
 *
 * @route PATCH /gipp-rh/payment-receipt
 * @param {import('express').Request}  req - Requisição com `user` e `body` contendo `id` + campos a alterar.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com o recibo atualizado parcialmente.
 */
async function patchPaymentReceipt(req, res) {
    const { user, body }  = req;
    const { id, ...fields } = body;

    const service = new GippRhService();
    const receipt = await service.patchPaymentReceipt(id, fields, user.registration, user.branch_code);
    return respond.ok(res, receipt);
}

// ─── Recibo para Exibição em Tela ──────────────────────────────────────────────

/**
 * Retorna recibos para exibição em tela (não PDF), filtrados por colaborador,
 * filial, intervalo de referência e tipo de pagamento.
 *
 * Query params: `employeeCode`, `branchCode`, `referenceInit`, `referenceEnd`, `paymentTypeId`.
 *
 * @route GET /gipp-rh/receipt
 * @param {import('express').Request}  req - Requisição com query params.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a lista de recibos.
 */
async function getReceipt(req, res) {
    const { employeeCode, branchCode, referenceInit, referenceEnd, paymentTypeId, date_from, date_to } = req.query;

    const receipt = new GippRhService();
    const data    = await receipt.getReceipt(employeeCode, branchCode, referenceInit, referenceEnd, paymentTypeId, date_from, date_to);
    return respond.ok(res, data);
}

// ─── Tipos de Pagamento ────────────────────────────────────────────────────────

/**
 * Retorna todos os tipos de pagamento disponíveis.
 *
 * @route GET /gipp-rh/payment-types
 * @param {import('express').Request}  req - Requisição Express.
 * @param {import('express').Response} res - Resposta Express.
 * @returns {Promise<void>} `200 OK` com a lista de tipos de pagamento.
 */
async function getPaymentTypes(req, res) {
    const service = new GippRhService();
    const data    = await service.getPaymentTypes();
    return respond.ok(res, data);
}

module.exports = {
    getActiveCompensations,
    getActiveBeneficiaries,
    postCompensations,
    putCompensations,
    postBeneficiary,
    putBeneficiary,
    getEmployeesPaginated,
    downloadReceipt,
    getReceipt,
    downloadReceiptByGroup,
    getEventCodes,
    postPaymentReceipt,
    getPaymentReceipts,
    putPaymentReceipt,
    patchPaymentReceipt,
    getPaymentTypes
};
