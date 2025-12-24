class ValidationError extends Error {
  constructor(message, fields) {
    super(message);
    this.fields = fields;
  }
}

module.exports = {ValidationError}