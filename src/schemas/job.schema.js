// Schemas de validação para rotas de vagas (jobs)

const { JOB_FIELDS } = require('../modules/gpprh/domain/jobs/job.fields');
const { BadRequestError } = require('../errors/bad-request.error');

const ALLOWED_FIELDS = Object.keys(JOB_FIELDS);

const createJobSchema = {
    branch_cod:    { type: 'string', required: true, minLength: 1, maxLength: 50 },
    branch_name:   { type: 'string', required: true, minLength: 1, maxLength: 200 },
    position_cod:  { type: 'string', required: true, minLength: 1, maxLength: 50 },
    position_name: { type: 'string', required: true, minLength: 1, maxLength: 200 },
    description:   { type: 'string', required: true, minLength: 10, maxLength: 5000 },
    salary_min:    { type: 'number', required: true, min: 0 },
    salary_max:    { type: 'number', required: true, min: 0 },
    location:      { type: 'string', required: true, minLength: 1, maxLength: 200 }
};

const updateJobSchema = {
    id:            { type: 'number', required: true },
    branch_cod:    { type: 'string', minLength: 1, maxLength: 50 },
    branch_name:   { type: 'string', minLength: 1, maxLength: 200 },
    position_cod:  { type: 'string', minLength: 1, maxLength: 50 },
    position_name: { type: 'string', minLength: 1, maxLength: 200 },
    description:   { type: 'string', minLength: 10, maxLength: 5000 },
    salary_min:    { type: 'number', min: 0 },
    salary_max:    { type: 'number', min: 0 },
    location:      { type: 'string', minLength: 1, maxLength: 200 }
};

/**
 * Middleware que bloqueia campos não permitidos no body.
 * Complementa os schemas sem precisar listar todos os campos como `required: false`.
 */
function blockUnknownJobFields(req, res, next) {
    const unknown = Object.keys(req.body || {}).filter(f => !ALLOWED_FIELDS.includes(f));
    if (unknown.length) {
        return next(new BadRequestError(`Unknown fields: ${unknown.join(', ')}`));
    }
    next();
}

/**
 * Valida que salary_min <= salary_max quando ambos forem enviados.
 */
function validateSalaryRange(req, res, next) {
    const { salary_min, salary_max } = req.body || {};
    if (salary_min != null && salary_max != null && salary_min > salary_max) {
        return next(new BadRequestError("'salary_min' must be less than or equal to 'salary_max'"));
    }
    next();
}

const jobLikeSchema = {
    job_id:       { type: 'number', required: true, min: 1 },
    candidate_id: { type: 'number', required: true, min: 1 },
};

const jobApplicationSchema = {
    job_id:       { type: 'number', required: true, min: 1 },
    candidate_id: { type: 'number', required: true, min: 1 },
};

const jobCommentSchema = {
    job_id:       { type: 'number', required: true, min: 1 },
    candidate_id: { type: 'number', required: true, min: 1 },
    comment:      { type: 'string', required: true, minLength: 1, maxLength: 1000 },
};

module.exports = {
    createJobSchema,
    updateJobSchema,
    blockUnknownJobFields,
    validateSalaryRange,
    jobLikeSchema,
    jobApplicationSchema,
    jobCommentSchema,
};
