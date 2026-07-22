// Schemas de validação para rotas de ativos e seguro (GAPP)
//
// Filosofia: aqui só validamos TIPO/FORMATO dos campos principais.
// Quem decide o que é obrigatório de verdade é a procedure/banco
// (sp_gapp_save_active_v2, sp_gapp_save_insurance) — evita duplicar
// regra de negócio em dois lugares e ficar dessincronizado quando o
// banco mudar. Erros de "campo obrigatório" vindos do banco chegam
// como SQLSTATE 45000 e são traduzidos para 400 pelo service.

const { BadRequestError } = require('../errors/bad-request.error');

// ─── Ativo / Veículo ────────────────────────────────────────────────

// `user_id_fk` e `work_group_fk` NÃO fazem parte deste schema de propósito —
// não são mais campos que o cliente envia. Ambos são sempre resolvidos no
// service a partir do usuário autenticado (JWT `id` → gapp_user.access_code
// → gapp_level.group_id_fk), tanto no create quanto no update. Se o cliente
// mandar, é ignorado (sobrescrito).
const activeFieldsSchema = {
    brand:              { type: 'string', maxLength: 100 },
    model:              { type: 'string', maxLength: 100 },
    number_nf:          { type: 'number' },
    date_purchase:      { type: 'string' },
    value_purchase:     { type: 'number' },
    photo:              { type: 'string', maxLength: 255 },
    change_date:        { type: 'string' },
    used_in:            { type: 'number' },
    is_vehicle:         { type: 'number', required: true, enum: [0, 1] },
    status_active:      { type: 'number' },
    units_id_fk:        { type: 'number' },
    id_active_class_fk: { type: 'number' },
};

const createActiveSchema = { ...activeFieldsSchema };

// No update, `is_vehicle` é opcional — se não vier, o service mantém o valor
// atual do ativo (resolvido no banco), em vez de exigir reenvio a cada PUT.
const updateActiveSchema = {
    ...activeFieldsSchema,
    is_vehicle: { type: 'number', required: false, enum: [0, 1] },
    active_id: { type: 'number', required: true }
};

/**
 * Valida a coerência entre `is_vehicle` e os sub-objetos `vehicle`/`insurance`.
 * Não valida campo a campo dentro deles — isso fica a cargo da procedure.
 */
function validateVehicleAndInsurancePayload(req, res, next) {
    const { is_vehicle, vehicle, insurance } = req.body || {};
    const isVehicle = Number(is_vehicle) === 1;

    if (isVehicle && (vehicle == null || typeof vehicle !== 'object' || Array.isArray(vehicle))) {
        return next(new BadRequestError("'vehicle' is required as an object when 'is_vehicle' = 1"));
    }

    if (insurance != null) {
        if (typeof insurance !== 'object' || Array.isArray(insurance)) {
            return next(new BadRequestError("'insurance' must be an object"));
        }
        if (!isVehicle) {
            return next(new BadRequestError("'insurance' only applies when 'is_vehicle' = 1"));
        }
    }

    next();
}

// ─── Seguro (standalone) ────────────────────────────────────────────
//
// Tipos abaixo conferidos contra a assinatura real de
// `sp_gapp_save_insurance` (não são mais um chute).

const insuranceCommonSchema = {
    ins_id_fk:         { type: 'number' },
    cov_id_fk:         { type: 'number' },
    util_id_fk:        { type: 'number' },
    status_insurance:  { type: 'number' },
    risk_cep:          { type: 'string', maxLength: 30 },
    policy_number:     { type: 'number' },
    proposal_number:   { type: 'number' },
    date_init:         { type: 'string' },
    date_final:        { type: 'string' },
    insurance_value:   { type: 'number' },
    deductible_value:  { type: 'number' },
    deductible_type:   { type: 'string', maxLength: 45 },
    form_payment:      { type: 'string', maxLength: 100 },
    iof_value:         { type: 'number' },
    adjustment_factor: { type: 'string', maxLength: 50 },
    backup_car:        { type: 'number' },
};

// Create = novo registro de seguro para um veículo (desativa o anterior, se houver)
const createInsuranceSchema = {
    ...insuranceCommonSchema,
    vehicle_id_fk: { type: 'number', required: true }
};

// Update = edita um registro de seguro existente pelo id
const updateInsuranceSchema = {
    ...insuranceCommonSchema,
    id_insurance: { type: 'number', required: true }
};

// ─── Consulta (GET) ─────────────────────────────────────────────────

const listActiveQuerySchema = {
    active_id:           { type: 'number' },
    brand:                { type: 'string', maxLength: 100 },
    model:                { type: 'string', maxLength: 100 },
    number_nf:            { type: 'number' },
    is_vehicle:           { type: 'number', enum: [0, 1] },
    status_active:        { type: 'number' },
    units_id_fk:          { type: 'number' },
    id_active_class_fk:   { type: 'number' },
    user_id_fk:           { type: 'number' },
    work_group_fk:        { type: 'number' },
    used_in:              { type: 'number' },
    date_purchase_from:   { type: 'string' },
    date_purchase_to:     { type: 'string' },
    page:                 { type: 'number', min: 1 },
    limit:                { type: 'number', min: 1, max: 100 },
};

const listVehicleQuerySchema = {
    vehicle_id:       { type: 'number' },
    active_id_fk:     { type: 'number' },
    license_plates:   { type: 'string', maxLength: 45 },
    chassi:           { type: 'string', maxLength: 40 },
    renavam:          { type: 'string', maxLength: 45 },
    color:            { type: 'string', maxLength: 45 },
    fuel_type_id_fk:  { type: 'number' },
    year:             { type: 'number' },
    year_model:       { type: 'number' },
    directed_by:      { type: 'number' },
    shielding:        { type: 'number', enum: [0, 1] },
    status_active:    { type: 'number' },
    units_id_fk:      { type: 'number' },
    page:             { type: 'number', min: 1 },
    limit:            { type: 'number', min: 1, max: 100 },
};

const listInsuranceQuerySchema = {
    id_insurance:      { type: 'number' },
    vehicle_id_fk:     { type: 'number' },
    status_insurance:  { type: 'number' },
    ins_id_fk:         { type: 'number' },
    cov_id_fk:         { type: 'number' },
    util_id_fk:        { type: 'number' },
    policy_number:     { type: 'number' },
    proposal_number:   { type: 'number' },
    date_init_from:    { type: 'string' },
    date_init_to:      { type: 'string' },
    date_final_from:   { type: 'string' },
    date_final_to:     { type: 'string' },
    page:              { type: 'number', min: 1 },
    limit:             { type: 'number', min: 1, max: 100 },
};

// ─── Despesas de Ativo ──────────────────────────────────────────────
//
// `local` (JSON) não entra aqui de propósito, mesma filosofia dos outros
// campos JSON deste arquivo — validado apenas pelo banco (NOT NULL).
// `active_id_fk` fica opcional por decisão de negócio: nem toda despesa
// precisa estar vinculada a um ativo. Quando vier, o service valida que o
// ativo pertence ao work_group_fk do usuário antes de aceitar.

const expenseFieldsSchema = {
    date:           { type: 'string', required: true },
    hour:           { type: 'string', required: true },
    description:    { type: 'string', required: true, maxLength: 255 },
    total_value:    { type: 'number', required: true },
    discount:       { type: 'number' },
    provider:       { type: 'string', maxLength: 255 },
    exp_type_id_fk: { type: 'number', required: true },
    driver_id_fk:   { type: 'number' },
    active_id_fk:   { type: 'number' },
    coupon_number:  { type: 'number' },
    store_id_fk:    { type: 'number' },
};

const createExpenseSchema = { ...expenseFieldsSchema };

const updateExpenseSchema = {
    ...expenseFieldsSchema,
    status_expen: { type: 'number', enum: [0, 1] }
};

const listExpensesQuerySchema = {
    expen_id:       { type: 'number' },
    hour:           { type: 'string' },
    active_id_fk:   { type: 'number' },
    exp_type_id_fk: { type: 'number' },
    description:    { type: 'string' },
    status_expen:   { type: 'number', enum: [0, 1] },
    date_start:      { type: 'string' },
    date_end:        { type: 'string' },
    page:            { type: 'number', min: 1 },
    limit:           { type: 'number', min: 1, max: 100 },
};

// Baseada na pcr_select_filtered_expenses (legado) — mesmos filtros +
// isolamento por work_group_fk, que o legado não tinha.
const listVehicleExpensesQuerySchema = {
    ...listExpensesQuerySchema,
    vehicle_id:      { type: 'number' },
    license_plates:  { type: 'string' },
    unit_id:         { type: 'number' },
    unit_name:       { type: 'string' },
};

/**
 * Cada exp_type_id_fk exige um objeto específico no body (exceto 6 —
 * Outros, que não tem tabela de detalhe). Só checa a presença/formato do
 * objeto — os campos dentro dele seguem a mesma filosofia do arquivo
 * (validados pelo banco via NOT NULL).
 */
const EXPENSE_TYPE_DETAIL_FIELD = {
    1: 'fuel',
    2: 'maintenance',
    3: 'sinister',
    4: 'fine',
    5: 'insurance',
};

function validateExpenseTypePayload(req, res, next) {
    const typeId = Number(req.body?.exp_type_id_fk);
    const requiredField = EXPENSE_TYPE_DETAIL_FIELD[typeId];

    if (!requiredField) return next(); // 6 (Outros) — nenhum objeto exigido

    const value = req.body[requiredField];
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
        return next(new BadRequestError(
            `'${requiredField}' is required as an object when exp_type_id_fk = ${typeId}`
        ));
    }
    next();
}

module.exports = {
    createActiveSchema,
    updateActiveSchema,
    validateVehicleAndInsurancePayload,
    createInsuranceSchema,
    updateInsuranceSchema,
    listActiveQuerySchema,
    listVehicleQuerySchema,
    listInsuranceQuerySchema,
    createExpenseSchema,
    updateExpenseSchema,
    listExpensesQuerySchema,
    listVehicleExpensesQuerySchema,
    validateExpenseTypePayload
};
