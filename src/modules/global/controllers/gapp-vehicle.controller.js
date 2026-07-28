const { GappVehicleUseCases } = require('../application/gapp/vehicle/gapp-vehicle.use-cases');
const { MysqlVehicleRepository } = require('../infrastructure/gapp/mysql-vehicle.repository');
const { MysqlGappUserRepository } = require('../infrastructure/gapp/mysql-gapp-user.repository');
const { MysqlGappInsuranceRepository } = require('../infrastructure/gapp/mysql-gapp-insurance.repository');
const { respond } = require('../../../utils/respond');

const useCases = new GappVehicleUseCases({
    repository: new MysqlVehicleRepository(),
    userRepository: new MysqlGappUserRepository(),
    insuranceRepository: new MysqlGappInsuranceRepository(),
});

// 🔹 LIST VEHICLES (com filtros e paginação, restrito ao work_group_fk do usuário)
async function listVehicles(req, res) {
  const result = await useCases.list(req.query, req.user);
  return respond.ok(res, result);
}

// 🔹 GET VEHICLE BY ID (com dados do ativo pai + seguro ativo, restrito ao work_group_fk do usuário)
async function getVehicleById(req, res) {
  const result = await useCases.getById(req.params.id, req.user);
  return respond.ok(res, result);
}

module.exports = { listVehicles, getVehicleById };
