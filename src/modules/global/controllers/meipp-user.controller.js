/**
 * @fileoverview Controller dos usuários do painel meipp (papéis).
 *
 * Não há rota de login: quem autentica é a sessão por cookie do módulo global.
 * Estas rotas concedem e revogam o papel de quem já existe lá.
 *
 * @module modules/global/controllers/meipp-user.controller
 */

const { MeippUserUseCases } = require('../application/meipp/user/meipp-user.use-cases');
const { MysqlMeippUserRepository } = require('../infrastructure/meipp/mysql-meipp-user.repository');
const { respond } = require('../../../utils/respond');

const useCases = new MeippUserUseCases({
    repository: new MysqlMeippUserRepository(),
});

async function list(req, res) {
    return respond.ok(res, await useCases.list(req.query));
}

async function getById(req, res) {
    return respond.ok(res, await useCases.getById(Number(req.params.id)));
}

/**
 * Quem sou eu no meipp.
 *
 * O painel precisa saber o papel para decidir o que mostrar — sem isso, a tela
 * ofereceria botões que o backend vai recusar com 403. O `req.meippUser` já foi
 * resolvido pelo `requireMeippRole`, então não há consulta extra.
 */
async function me(req, res) {
    return respond.ok(res, req.meippUser);
}

async function create(req, res) {
    return respond.created(res, await useCases.create(req.body));
}

async function update(req, res) {
    return respond.ok(res, await useCases.update(Number(req.params.id), req.body));
}

async function deactivate(req, res) {
    return respond.ok(res, await useCases.deactivate(Number(req.params.id), req.meippUser));
}

module.exports = { list, getById, me, create, update, deactivate };
