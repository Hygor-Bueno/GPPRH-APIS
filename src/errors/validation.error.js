const { AppError } = require('./app.error');

class ValidationError extends AppError {
  constructor(message, fields = []) {
    super(message, 422);
    this.fields = fields;
  }
}

module.exports = { ValidationError };
