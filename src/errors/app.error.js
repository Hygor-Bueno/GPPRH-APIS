class AppError extends Error {
  constructor(
    message,
    statusCode = 400,
    options = {}
  ) {
    super(message);

    this.statusCode = statusCode;

    // 🆕 opcionais (não quebram nada)
    this.code = options.code || 'GENERIC_ERROR';
    this.details = options.details || null;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = { AppError };
