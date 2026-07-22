const { GappInsuranceService } = require('../services/gapp-insurance.service');
const { respond } = require('../../../utils/respond');

// 🔹 CREATE INSURANCE (novo registro — desativa o seguro ativo anterior do veículo, se houver)
async function createInsurance(req, res) {
  const service = new GappInsuranceService();
  const result = await service.save({ ...req.body, is_update: 0 });
  return respond.created(res, result);
}

// 🔹 UPDATE INSURANCE (edita o registro `id_insurance` informado)
async function updateInsurance(req, res) {
  const service = new GappInsuranceService();
  const result = await service.save({ ...req.body, is_update: 1 });
  return respond.ok(res, result);
}

// 🔹 LIST INSURANCE (histórico — inclui registros desativados)
async function listInsurance(req, res) {
  const service = new GappInsuranceService();
  const result = await service.list(req.query);
  return respond.ok(res, result);
}

// 🔹 GET INSURANCE BY ID (com seguradora/cobertura/utilização resolvidos por nome)
async function getInsuranceById(req, res) {
  const service = new GappInsuranceService();
  const result = await service.getById(req.params.id);
  return respond.ok(res, result);
}

module.exports = { createInsurance, updateInsurance, listInsurance, getInsuranceById };
