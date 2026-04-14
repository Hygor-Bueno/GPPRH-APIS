const { BadRequestError } = require("../../../errors/bad-request.error");
const { JOB_FIELDS } = require("../domain/jobs/job.fields");
const REQUIRED_FIELDS = Object.freeze({
  create: [
    'branch_cod',
    'branch_name',
    'position_cod',
    'position_name',
    'description',
    'salary_min',
    'salary_max',
    'location',
    'created_by'
  ],
  update: [] // PATCH/PUT valida só campos enviados
});

function jobValidator(data, { mode = 'create' } = {}) {
  const missing = [];
  const invalidFields = [];

  // 🔹 1. Bloquear campos inexistentes (create e update)
  for (const field of Object.keys(data)) {
    if (!JOB_FIELDS[field]) {
      invalidFields.push(field);
    }
  }

  // 🔹 2. Validar obrigatórios apenas no CREATE
  if (mode === 'create') {
    for (const field of REQUIRED_FIELDS.create) {
      const value = data[field];
      if (value === undefined || value === null || value === '') {
        missing.push(field);
      }
    }
  }

  if (missing.length || invalidFields.length) {
    const errors = [];
    if (missing.length) errors.push(`Missing: ${missing.join(', ')}`);
    if (invalidFields.length) errors.push(`Invalid fields: ${invalidFields.join(', ')}`);
    throw new BadRequestError(errors.join(' | '));
  }
}

module.exports = { jobValidator };