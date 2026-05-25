// Schemas de validação para rotas de GIPP-RH (compensações e beneficiários)

// Formato YYYYMM (ex: 202401)
const REFERENCE_PATTERN = /^\d{6}$/;
// Formato YYYY-MM-DD
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const postCompensationSchema = {
    name:        { type: 'string',  required: true,  minLength: 1, maxLength: 200 },
    description: { type: 'string',  required: true,  minLength: 1, maxLength: 500 },
    active:      { type: 'boolean', required: true }
};

const putCompensationSchema = {
    id:          { type: 'number',  required: true },
    name:        { type: 'string',  required: true,  minLength: 1, maxLength: 200 },
    description: { type: 'string',  required: true,  minLength: 1, maxLength: 500 },
    active:      { type: 'boolean', required: true }
};

const postBeneficiarySchema = {
    employee_id:     { type: 'string', required: true },
    compensation_id: { type: 'number', required: true, min: 1 },
    value:           { type: 'number', required: true, min: 0 },
    branch_code:     { type: 'string', required: true },
    start_date:      { type: 'string', required: true, pattern: DATE_PATTERN }
};

const putBeneficiarySchema = {
    id:              { type: 'number', required: true },
    employee_id:     { type: 'string', required: true },
    compensation_id: { type: 'number', required: true, min: 1 },
    value:           { type: 'number', required: true, min: 0 },
    branch_code:     { type: 'string', required: true },
    start_date:      { type: 'string', required: true, pattern: DATE_PATTERN }
};

const getReceiptQuerySchema = {
    reference:     { type: 'string', required: true, pattern: REFERENCE_PATTERN },
    employee_code: { type: 'string', maxLength: 20 },
    payee_id:      { type: 'string', maxLength: 10 }
};

const postPaymentReceiptSchema = {
    company_code:     { type: 'string',  required: true, minLength: 1, maxLength: 10 },
    branch_code:      { type: 'string',  required: true, minLength: 1, maxLength: 10 },
    // CLT: employee_code | Payee: payee_id — pelo menos um deve ser enviado (validado no service)
    employee_code:    { type: 'string',  minLength: 1, maxLength: 20 },
    payee_id:         { type: 'number',  min: 1 },
    employee_name:    { type: 'string',  required: true, minLength: 1, maxLength: 200 },
    branch_name:      { type: 'string',  required: true, minLength: 1, maxLength: 200 },
    reference:        { type: 'string',  required: true, pattern: REFERENCE_PATTERN },
    description:      { type: 'string',  required: true, minLength: 1, maxLength: 500 },
    amount:           { type: 'number',  required: true, min: 0 },
    movement_type:    { type: 'string',  required: true, enum: ['E', 'D'] },
    is_active:        { type: 'boolean', required: true },
    // opcionais
    event_code:       { type: 'string',  maxLength: 50 },
    work_schedule_id: { type: 'string'   },
    payment_type_id:  { type: 'number',  min: 1 },
    receipt_group_id: { type: 'string',  maxLength: 50 }
};

// PUT — substitui o registro inteiro (todos os campos obrigatórios)
const putPaymentReceiptSchema = {
    id:               { type: 'number',  required: true },
    description:      { type: 'string',  required: true, minLength: 1, maxLength: 500 },
    amount:           { type: 'number',  required: true, min: 0 },
    movement_type:    { type: 'string',  required: true, enum: ['E', 'D'] },
    is_active:        { type: 'boolean', required: true },
    event_code:       { type: 'string',  maxLength: 50 },
    work_schedule_id: { type: 'string'   },
    payment_type_id:  { type: 'number',  min: 1 }
};

// PATCH — atualiza apenas os campos enviados (só id é obrigatório)
const patchPaymentReceiptSchema = {
    id:               { type: 'number',  required: true },
    description:      { type: 'string',  minLength: 1, maxLength: 500 },
    amount:           { type: 'number',  min: 0 },
    movement_type:    { type: 'string',  enum: ['E', 'D'] },
    is_active:        { type: 'boolean'  },
    event_code:       { type: 'string'   },
    work_schedule_id: { type: 'string',  min: 1 },
    payment_type_id:  { type: 'number',  min: 1 }
};

module.exports = {
    postCompensationSchema,
    putCompensationSchema,
    postBeneficiarySchema,
    putBeneficiarySchema,
    getReceiptQuerySchema,
    postPaymentReceiptSchema,
    putPaymentReceiptSchema,
    patchPaymentReceiptSchema
};
