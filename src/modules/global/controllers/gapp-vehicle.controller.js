const { GappVehicleService } = require('../services/gapp-vehicle.service');
const { respond } = require('../../../utils/respond');

// 🔹 LIST VEHICLES (com filtros e paginação)
async function listVehicles(req, res) {
  const service = new GappVehicleService();
  const result = await service.list(req.query);
  return respond.ok(res, result);
}

// 🔹 GET VEHICLE BY ID (com dados do ativo pai + seguro ativo, se houver)
async function getVehicleById(req, res) {
  const service = new GappVehicleService();
  const result = await service.getById(req.params.id);
  return respond.ok(res, result);
}

module.exports = { listVehicles, getVehicleById };
