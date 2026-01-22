const { AppError } = require('../errors/AppError');

function errorHandler(err, req, res, next) {
  console.error(err);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: true,
      message: err.message,
      fields: err.fields
    });
  }

  return res.status(500).json({
    error: true,
    message: 'Internal server error'
  });
}

module.exports = { errorHandler };
