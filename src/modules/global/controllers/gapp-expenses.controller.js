const { GappExpensesService } = require('../services/gapp-expenses.service');
const { respond } = require('../../../utils/respond');

// 🔹 CREATE EXPENSE
async function createExpense(req, res) {
  const service = new GappExpensesService();
  const result = await service.create(req.body, req.user);
  return respond.created(res, result);
}

// 🔹 UPDATE EXPENSE
async function updateExpense(req, res) {
  const service = new GappExpensesService();
  const result = await service.update(Number(req.params.id), req.body, req.user);
  return respond.ok(res, result);
}

// 🔹 LIST EXPENSES (qualquer ativo, com filtros e paginação)
async function listExpenses(req, res) {
  const service = new GappExpensesService();
  const result = await service.list(req.query, req.user);
  return respond.ok(res, result);
}

// 🔹 LIST VEHICLE EXPENSES (restrito a veículos — filtro por placa/unidade)
async function listVehicleExpenses(req, res) {
  const service = new GappExpensesService();
  const result = await service.listVehicleExpenses(req.query, req.user);
  return respond.ok(res, result);
}

// 🔹 GET EXPENSE BY ID (com detalhe do tipo aninhado — fuel/maintenance/sinister/fine/insurance)
async function getExpenseById(req, res) {
  const service = new GappExpensesService();
  const result = await service.getById(Number(req.params.id), req.user);
  return respond.ok(res, result);
}

module.exports = { createExpense, updateExpense, listExpenses, listVehicleExpenses, getExpenseById };
