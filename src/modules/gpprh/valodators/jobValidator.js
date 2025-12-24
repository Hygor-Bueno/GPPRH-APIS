const { JOB_FIELDS } = require('../schema/jobSchema');

function jobValidator(data) {
  const missing = [];
  const invalidTypes = [];

  for (const [field, meta] of Object.entries(JOB_FIELDS)) {
    const value = data[field];
    if (meta.required && (value === undefined || value === null || value === '')) {
      missing.push(field);
      continue;
    }
  }

  if (missing.length || invalidTypes.length) {
    const errors = [];
    if (missing.length) errors.push(`Missing: ${missing.join(', ')}`);
    if (invalidTypes.length) errors.push(`Invalid types: ${invalidTypes.join(', ')}`);
    const err = new Error(errors.join(' | '));
    err.name = 'ValidationError';
    throw err;
  }
}

module.exports = { jobValidator };