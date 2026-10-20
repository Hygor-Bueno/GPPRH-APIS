/**
 * @fileoverview Traduz o estouro de tamanho do multer para um `AppError` que
 * diz o limite REAL da instância.
 *
 * O `MulterError` não carrega o limite que foi violado, e a casa tem três
 * instâncias com tetos diferentes (foto de colaborador 5 MB, rosto 12 MB,
 * FileService 200 MB). O `error.middleware` respondia "50 MB" para todas — um
 * número que não era o limite de nenhuma delas. Quem sabe o teto é quem criou a
 * instância, então a tradução acontece aqui, e não no handler global.
 *
 * @module utils/file/upload-limit
 */

const multer = require('multer');
const { AppError } = require('../../errors/app.error');

/** @enum {string} */
const UploadErrorCode = Object.freeze({
    FILE_TOO_LARGE: 'UPLOAD_FILE_TOO_LARGE',
});

/** Métodos do multer que devolvem middleware. */
const MIDDLEWARE_FACTORIES = ['single', 'array', 'fields', 'none', 'any'];

/** @param {number} bytes */
function formatMb(bytes) {
    return `${Math.round(bytes / 1048576)} MB`;
}

/**
 * Embrulha uma instância multer: os middlewares que ela gera passam a
 * converter `LIMIT_FILE_SIZE` em `AppError` com o limite informado. Os demais
 * erros seguem intactos para o `error.middleware`.
 *
 * A interface não muda — `.single('file')`, `.fields([...])` etc. continuam
 * funcionando como antes nas rotas.
 *
 * @param {import('multer').Multer} instance
 * @param {number} maxBytes - O mesmo valor de `limits.fileSize` da instância.
 * @returns {import('multer').Multer}
 */
function withUploadLimit(instance, maxBytes) {
    const wrapped = Object.create(instance);

    for (const name of MIDDLEWARE_FACTORIES) {
        wrapped[name] = (...args) => {
            const middleware = instance[name](...args);
            return (req, res, next) => middleware(req, res, (err) => {
                if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                    return next(new AppError(
                        `Arquivo muito grande. Tamanho máximo permitido: ${formatMb(maxBytes)}.`,
                        400,
                        { code: UploadErrorCode.FILE_TOO_LARGE }
                    ));
                }
                return next(err);
            });
        };
    }

    return wrapped;
}

module.exports = { withUploadLimit, UploadErrorCode };
