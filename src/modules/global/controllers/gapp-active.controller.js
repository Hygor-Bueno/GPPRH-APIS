const { GappActiveUseCases } = require('../application/gapp/active/gapp-active.use-cases');
const { MysqlActiveRepository } = require('../infrastructure/gapp/mysql-active.repository');
const { MysqlGappUserRepository } = require('../infrastructure/gapp/mysql-gapp-user.repository');
const { MysqlGappInsuranceRepository } = require('../infrastructure/gapp/mysql-gapp-insurance.repository');
const { respond } = require('../../../utils/respond');

const useCases = new GappActiveUseCases({
    repository: new MysqlActiveRepository(),
    userRepository: new MysqlGappUserRepository(),
    insuranceRepository: new MysqlGappInsuranceRepository(),
});

// 🔹 CREATE ACTIVE (+ vehicle + seguro, atômico)
async function createActive(req, res) {
  const result = await useCases.save(req.body, req.user);
  return respond.created(res, result);
}

// 🔹 UPDATE ACTIVE (+ vehicle + seguro, atômico)
async function updateActive(req, res) {
  const result = await useCases.save(req.body, req.user);
  return respond.ok(res, result);
}

// 🔹 LIST ACTIVE (com filtros e paginação, restrito ao work_group_fk do usuário)
async function listActive(req, res) {
  const result = await useCases.list(req.query, req.user);
  return respond.ok(res, result);
}

// 🔹 GET ACTIVE BY ID (com veículo + seguro ativo, restrito ao work_group_fk do usuário)
async function getActiveById(req, res) {
  const result = await useCases.getById(req.params.id, req.user);
  return respond.ok(res, result);
}

module.exports = { createActive, updateActive, listActive, getActiveById };
