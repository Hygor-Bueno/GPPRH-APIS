const { GappActiveService } = require('../services/gapp-active.service');
const { respond } = require('../../../utils/respond');

// 🔹 CREATE ACTIVE (+ vehicle + seguro, atômico)
async function createActive(req, res) {
  const service = new GappActiveService();
  const result = await service.save(req.body, req.user);
  return respond.created(res, result);
}

// 🔹 UPDATE ACTIVE (+ vehicle + seguro, atômico)
async function updateActive(req, res) {
  const service = new GappActiveService();
  const result = await service.save(req.body, req.user);
  return respond.ok(res, result);
}

// 🔹 LIST ACTIVE (com filtros e paginação, restrito ao work_group_fk do usuário)
async function listActive(req, res) {
  const service = new GappActiveService();
  const result = await service.list(req.query, req.user);
  return respond.ok(res, result);
}

// 🔹 GET ACTIVE BY ID (com veículo + seguro ativo, restrito ao work_group_fk do usuário)
async function getActiveById(req, res) {
  const service = new GappActiveService();
  const result = await service.getById(req.params.id, req.user);
  return respond.ok(res, result);
}

module.exports = { createActive, updateActive, listActive, getActiveById };
