/**
 * @fileoverview Autorização por papel no painel meipp.
 *
 * Roda **depois** do `auth.middleware` do global: quem autentica continua sendo
 * a sessão por cookie. Este middleware só traduz o usuário da sessão no papel
 * que ele tem dentro do meipp (`meipp_users.role`) e barra o que estiver abaixo
 * do patamar exigido pela rota.
 *
 * Também popula `req.meippUser`, que é o que os casos de uso gravam em
 * `created_by`/`uploaded_by` e o middleware de auditoria usa em `user_id` —
 * essas colunas apontam para `meipp_users.id`, não para o id da sessão global.
 *
 * @module middlewares/meipp-role.middleware
 */

const { MysqlMeippUserRepository } = require('../modules/global/infrastructure/meipp/mysql-meipp-user.repository');
const { MeippRole } = require('../modules/global/domain/meipp/meipp.enums');
const { hasAtLeast } = require('../modules/global/domain/meipp/meipp-access.rules');

const repository = new MysqlMeippUserRepository();

/**
 * Exige que o usuário da sessão tenha acesso ao meipp com pelo menos o papel
 * informado.
 *
 * @param {string} [minimumRole] - `viewer` (padrão), `editor` ou `admin`.
 * @returns {import('express').RequestHandler}
 */
function requireMeippRole(minimumRole = MeippRole.VIEWER) {
    return async (req, res, next) => {
        try {
            const globalUserId = req.user?.id;

            if (!globalUserId) {
                return res.status(401).json({
                    error: true,
                    message: 'Sessão não identificada.',
                });
            }

            // Uma rota pode ter dois middlewares de papel encadeados (um do
            // grupo, outro mais restrito); só a primeira consulta vai ao banco.
            const meippUser = req.meippUser || await repository.findByGlobalUserId(globalUserId);

            if (!meippUser) {
                return res.status(403).json({
                    error: true,
                    message: 'Você não tem acesso ao meipp.',
                });
            }

            req.meippUser = meippUser;

            if (!hasAtLeast(meippUser.role, minimumRole)) {
                return res.status(403).json({
                    error: true,
                    message: `Esta ação exige o papel "${minimumRole}" no meipp.`,
                });
            }

            return next();
        } catch (error) {
            return next(error);
        }
    };
}

/** Atalhos de leitura, para as rotas ficarem legíveis. */
const requireMeippViewer = () => requireMeippRole(MeippRole.VIEWER);
const requireMeippEditor = () => requireMeippRole(MeippRole.EDITOR);
const requireMeippAdmin  = () => requireMeippRole(MeippRole.ADMIN);

module.exports = {
    requireMeippRole,
    requireMeippViewer,
    requireMeippEditor,
    requireMeippAdmin,
};
