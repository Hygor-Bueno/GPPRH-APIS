const { JOB_FIELDS } = require('../schema/jobSchema');

function jobValidator(data, { mode = 'create' } = {}) {
  const missing = [];
  const invalidFields = [];

  const allowedFields = Object.keys(JOB_FIELDS);

  // 🔹 PUT / PATCH → validar apenas o que veio
  if (mode === 'update') {
    for (const field of Object.keys(data)) {
      if (!allowedFields.includes(field)) {
        invalidFields.push(field);
      }
    }
  }

  // 🔹 POST → validar obrigatórios
  if (mode === 'create') {
    for (const [field, meta] of Object.entries(JOB_FIELDS)) {
      const value = data[field];
      if (meta.required && (value === undefined || value === null || value === '')) {
        missing.push(field);
      }
    }
  }

  if (missing.length || invalidFields.length) {
    const errors = [];
    if (missing.length) errors.push(`Missing: ${missing.join(', ')}`);
    if (invalidFields.length) errors.push(`Invalid fields: ${invalidFields.join(', ')}`);

    const err = new Error(errors.join(' | '));
    err.name = 'ValidationError';
    throw err;
  }
}

module.exports = { jobValidator };
