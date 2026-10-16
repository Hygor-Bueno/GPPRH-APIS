/**
 * @fileoverview Controller da tela de tratamento do ponto: inconsistências,
 * detalhe do dia, as duas visões de marcação e a lista de pessoas.
 *
 * @module modules/global/controllers/cppp-inconsistency.controller
 */

const { inconsistencyUseCases } = require('../infrastructure/cppp/cppp-services');
const { respond } = require('../../../utils/respond');

/** @route GET /cppp/inconsistencies?from=&to=&cpf=&issue=&status=&page=&limit= */
async function list(req, res) {
    return respond.ok(res, await inconsistencyUseCases.list(req.query));
}

/** @route GET /cppp/days/:cpf/:date */
async function day(req, res) {
    return respond.ok(res, await inconsistencyUseCases.day(req.params.cpf, req.params.date));
}

/** @route GET /cppp/punches?view=afd|tratada&from=&to=&cpf=&device_id=&page=&limit= */
async function punches(req, res) {
    return respond.ok(res, await inconsistencyUseCases.punches(req.query));
}

/** @route GET /cppp/employees?search=&all=1&page=&limit= */
async function employees(req, res) {
    return respond.ok(res, await inconsistencyUseCases.employees(req.query));
}

module.exports = { list, day, punches, employees };
