const { GappLookupService } = require('../services/gapp-lookup.service');
const { respond } = require('../../../utils/respond');

async function listUnits(req, res) {
  const service = new GappLookupService();
  return respond.ok(res, await service.listUnits());
}

async function listActiveClass(req, res) {
  const service = new GappLookupService();
  return respond.ok(res, await service.listActiveClass());
}

async function listWorkGroup(req, res) {
  const service = new GappLookupService();
  return respond.ok(res, await service.listWorkGroup());
}

async function listDriver(req, res) {
  const service = new GappLookupService();
  return respond.ok(res, await service.listDriver());
}

async function listFuelType(req, res) {
  const service = new GappLookupService();
  return respond.ok(res, await service.listFuelType());
}

async function listUser(req, res) {
  const service = new GappLookupService();
  return respond.ok(res, await service.listUser());
}

async function listInsuranceCompany(req, res) {
  const service = new GappLookupService();
  return respond.ok(res, await service.listInsuranceCompany());
}

async function listTypeCoverage(req, res) {
  const service = new GappLookupService();
  return respond.ok(res, await service.listTypeCoverage());
}

async function listUtilization(req, res) {
  const service = new GappLookupService();
  return respond.ok(res, await service.listUtilization());
}

async function listDepartments(req, res) {
  const service = new GappLookupService();
  return respond.ok(res, await service.listDepartments());
}

async function listDamageType(req, res) {
  const service = new GappLookupService();
  return respond.ok(res, await service.listDamageType());
}

async function listInfractions(req, res) {
  const service = new GappLookupService();
  return respond.ok(res, await service.listInfractions());
}

module.exports = {
  listUnits, listActiveClass, listWorkGroup, listDriver, listFuelType, listUser,
  listInsuranceCompany, listTypeCoverage, listUtilization, listDepartments,
  listDamageType, listInfractions
};
