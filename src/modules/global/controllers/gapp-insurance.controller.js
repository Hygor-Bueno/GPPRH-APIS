const { GappInsuranceUseCases } = require('../application/gapp/insurance/gapp-insurance.use-cases');
const { MysqlGappInsuranceRepository } = require('../infrastructure/gapp/mysql-gapp-insurance.repository');
const { MysqlGappUserRepository } = require('../infrastructure/gapp/mysql-gapp-user.repository');
const { respond } = require('../../../utils/respond');

const useCases = new GappInsuranceUseCases({
    repository: new MysqlGappInsuranceRepository(),
    userRepository: new MysqlGappUserRepository(),
});

// 🔹 CREATE INSURANCE (novo registro — desativa o seguro ativo anterior do veículo, se houver)
async function createInsurance(req, res) {
  const result = await useCases.save({ ...req.body, is_update: 0 }, req.user);
  return respond.created(res, result);
}

// 🔹 UPDATE INSURANCE (edita o registro `id_insurance` informado)
async function updateInsurance(req, res) {
  const result = await useCases.save({ ...req.body, is_update: 1 }, req.user);
  return respond.ok(res, result);
}

// 🔹 LIST INSURANCE (histórico — inclui registros desativados, restrito ao work_group_fk do usuário)
async function listInsurance(req, res) {
  const result = await useCases.list(req.query, req.user);
  return respond.ok(res, result);
}

// 🔹 GET INSURANCE BY ID (com seguradora/cobertura/utilização resolvidos por nome, restrito ao work_group_fk do usuário)
async function getInsuranceById(req, res) {
  const result = await useCases.getById(req.params.id, req.user);
  return respond.ok(res, result);
}

module.exports = { createInsurance, updateInsurance, listInsurance, getInsuranceById };
