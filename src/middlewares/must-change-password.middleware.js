/**
 * @fileoverview Bloqueia o usuário com troca de senha pendente.
 *
 * Depois de um reset feito pela gestão de acessos, o usuário fica com
 * `must_change_password = 1` e a senha temporária. Até trocar, ele só pode:
 *
 *   GET  /me               descobrir que precisa trocar
 *   PUT  /change-password  trocar
 *   POST /logout           desistir
 *
 * Qualquer outra rota responde 403 com `code: 'MUST_CHANGE_PASSWORD'`.
 *
 * O front usa a flag do `/me` para abrir a tela de troca — mas é este
 * middleware que garante a regra. Sem ele, bastaria chamar a API direto para
 * usar o sistema inteiro com a senha temporária, que costuma circular por
 * mensagem ou papel até chegar ao usuário.
 *
 * @module middlewares/must-change-password
 */

/**
 * Caminhos liberados, relativos ao router onde o middleware é montado.
 * Comparados contra `req.path`, então não incluem o prefixo do router.
 */
const ALLOWED_PATHS = new Set([
    '/me',
    '/change-password',
    '/logout',
]);

function mustChangePassword(req, res, next) {
    if (!req.user?.must_change_password) return next();

    if (ALLOWED_PATHS.has(req.path)) return next();

    return res.status(403).json({
        error: true,
        code: 'MUST_CHANGE_PASSWORD',
        message: 'Sua senha foi resetada. Defina uma nova senha para continuar.',
    });
}

module.exports = { mustChangePassword, ALLOWED_PATHS };
