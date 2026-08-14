// Schemas de validação para rotas GIPP (registros de ponto e pagamentos)

// ─── Registros de Ponto ───────────────────────────────────────────────────────

const postTimeRecordSchema = {
    employee_id:        { type: 'string', required: true, minLength: 1 },
    id_record_type_fk:  { type: 'number', required: true, min: 1 },
    branch_time_record: { type: 'string', required: true, minLength: 1 },
};

const putTimeRecordSchema = {
    id_time_records: { type: 'number', required: true, min: 1 },
};

const discardTimeRecordSchema = {
    cod_work_schedule: { type: 'string', required: true, minLength: 1 },
};

// ─── Pagamentos ───────────────────────────────────────────────────────────────
// codWorkSchedules é um array — validado no controller; schema valida apenas o envelope

const postPaymentsSchema = {};

const postPaymentsCloseSchema = {};

module.exports = {
    postTimeRecordSchema,
    putTimeRecordSchema,
    discardTimeRecordSchema,
    postPaymentsSchema,
    postPaymentsCloseSchema,
};
