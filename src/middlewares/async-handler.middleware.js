/**
 * Wrapper para handlers async no Express 4.
 *
 * No Express 4, erros lançados dentro de funções async NÃO são
 * capturados automaticamente — eles viram UnhandledPromiseRejection
 * e podem travar o servidor.
 *
 * Este wrapper garante que qualquer erro (throw ou promise rejeitada)
 * seja repassado para o middleware de erro central via next(err).
 *
 * @param {Function} fn - Handler async (req, res, next) => Promise
 * @returns {Function} Handler do Express com captura de erros
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        try {
            Promise.resolve(fn(req, res, next)).catch(next);
        } catch (err) {
            next(err);
        }
    };
}

module.exports = { asyncHandler };
