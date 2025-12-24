function validateRequiredFields(data, fields) {
  const missing = fields.filter(
    field => data[field] === undefined || data[field] === null || data[field] === ''
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required fields: ${missing.join(', ')}`
    );
  }
}

module.exports = { validateRequiredFields };
