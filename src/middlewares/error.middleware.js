const multer  = require('multer');
const { AppError } = require('../errors/app.error');

function errorHandler(err, req, res, next) {
  // AppError operacionais não precisam de stack trace no log
  if (!(err instanceof AppError)) console.error('[server] Unhandled error caught by middleware:', err);

  // 4xx é erro de uso e continua fora do log. 5xx é falha nossa: o cliente só
  // recebe `message` e `code` — `details` não atravessa a borda de propósito —,
  // então sem esta linha a causa real (timeout, deadlock, pool esgotado) não
  // fica registrada em lugar nenhum e o incidente vira irreproduzível.
  if (err instanceof AppError && err.statusCode >= 500) {
    console.error('[server] AppError 5xx:', {
      method: req.method,
      path: req.originalUrl,
      status: err.statusCode,
      code: err.code,
      message: err.message,
      cause: err.details?.message ?? err.details?.originalError?.message ?? null,
    });
  }

  // Erros operacionais conhecidos
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: true,
      message: err.message,
      // Identificador estável da causa, para o cliente decidir o que fazer sem
      // casar em texto — mensagem muda com revisão de copy, código não.
      // Aditivo: quem já consumia `message` e `fields` não vê diferença.
      //
      // `err.details` NÃO sai daqui, de propósito: ele às vezes carrega o erro
      // original inteiro (ver o 503 em face-recognition.client.js), e isso é
      // estrutura interna que não pode atravessar a borda.
      code: err.code,
      fields: err.fields
    });
  }

  // Erros do multer (upload de arquivo)
  if (err instanceof multer.MulterError) {
    const MSG = {
      LIMIT_FILE_SIZE: 'Arquivo muito grande. Tamanho máximo permitido: 50 MB.',
      LIMIT_FILE_COUNT: 'Arquivos demais em uma única requisição.',
      LIMIT_UNEXPECTED_FILE: 'Campo de arquivo inesperado. Use o campo "files" (ou "file").',
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
