const { GappExpensesUseCases } = require('../application/gapp/expenses/gapp-expenses.use-cases');
const { MysqlExpensesRepository } = require('../infrastructure/gapp/mysql-expenses.repository');
const { MysqlGappUserRepository } = require('../infrastructure/gapp/mysql-gapp-user.repository');
const { respond } = require('../../../utils/respond');

const useCases = new GappExpensesUseCases({
    repository: new MysqlExpensesRepository(),
    userRepository: new MysqlGappUserRepository(),
});

// 🔹 CREATE EXPENSE
async function createExpense(req, res) {
  const result = await useCases.create(req.body, req.user);
  return respond.created(res, result);
}

// 🔹 UPDATE EXPENSE
async function updateExpense(req, res) {
  const result = await useCases.update(Number(req.params.id), req.body, req.user);
  return respond.ok(res, result);
}

// 🔹 LIST EXPENSES (qualquer ativo, com filtros e paginação)
async function listExpenses(req, res) {
  const result = await useCases.list(req.query, req.user);
  return respond.ok(res, result);
}

// 🔹 LIST VEHICLE EXPENSES (restrito a veículos — filtro por placa/unidade)
async function listVehicleExpenses(req, res) {
  const result = await useCases.listVehicleExpenses(req.query, req.user);
  return respond.ok(res, result);
}

// 🔹 GET EXPENSE BY ID (com detalhe do tipo aninhado — fuel/maintenance/sinister/fine/insurance)
async function getExpenseById(req, res) {
  const result = await useCases.getById(Number(req.params.id), req.user);
  return respond.ok(res, result);
}

module.exports = { createExpense, updateExpense, listExpenses, listVehicleExpenses, getExpenseById };
