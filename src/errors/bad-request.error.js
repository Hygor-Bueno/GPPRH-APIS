const { AppError } = require('./app.error');

class BadRequestError extends AppError {
  constructor(message) {
    super(message, 400);
  }
}

module.exports = { BadRequestError };
