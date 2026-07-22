const multer  = require('multer');
const { AppError } = require('../errors/app.error');

function errorHandler(err, req, res, next) {
  // AppError operacionais não precisam de stack trace no log
  if (!(err instanceof AppError)) console.error('[server] Unhandled error caught by middleware:', err);

  // Erros operacionais conhecidos
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: true,
      message: err.message,
      fields: err.fields
    });
  }

  // Erros do multer (upload de arquivo)
  if (err instanceof multer.MulterError) {
    const MSG = {
      LIMIT_FILE_SIZE: 'Arquivo muito grande. Tamanho máximo permitido: 10 MB.',
      LIMIT_UNEXPECTED_FILE: 'Campo de arquivo inesperado. Use o campo "file".',
    };
    return res.status(400).json({
      error: true,
      message: MSG[err.code] || `Erro no upload: ${err.message}`
    });
  }

  // HTTP status já definido (ex.: erros do Express)
  if (err.statusCode) {
    return res.status(err.statusCode).json({
      error: true,
      message: err.message || 'Erro interno'
    });
  }

  console.error('[server] Unhandled error:', err);
  return res.status(500).json({
    error: true,
    message: 'Erro interno do servidor. Tente novamente mais tarde.'
  });
}

module.exports = { errorHandler };
