const { GappLookupUseCases } = require('../application/gapp/lookup/gapp-lookup.use-cases');
const { MysqlLookupRepository } = require('../infrastructure/gapp/mysql-lookup.repository');
const { respond } = require('../../../utils/respond');

const useCases = new GappLookupUseCases({ repository: new MysqlLookupRepository() });

async function listUnits(req, res) {
  return respond.ok(res, await useCases.listUnits());
}
async function listCompany(req, res) {
  return respond.ok(res, await useCases.listCompany());
}

async function listActiveClass(req, res) {
  return respond.ok(res, await useCases.listActiveClass());
}
async function listActiveType(req, res) {
  return respond.ok(res, await useCases.listActiveType());
}

async function listWorkGroup(req, res) {
  return respond.ok(res, await useCases.listWorkGroup());
}

async function listDriver(req, res) {
  return respond.ok(res, await useCases.listDriver());
}

async function listFuelType(req, res) {
  return respond.ok(res, await useCases.listFuelType());
}

async function listUser(req, res) {
  return respond.ok(res, await useCases.listUser());
}

async function listInsuranceCompany(req, res) {
  return respond.ok(res, await useCases.listInsuranceCompany());
}

async function listTypeCoverage(req, res) {
  return respond.ok(res, await useCases.listTypeCoverage());
}

async function listUtilization(req, res) {
  return respond.ok(res, await useCases.listUtilization());
}

async function listDepartments(req, res) {
  return respond.ok(res, await useCases.listDepartments());
}

async function listSubDepartments(req, res) {
  return respond.ok(res, await useCases.listSubDepartments());
}

async function listDamageType(req, res) {
  return respond.ok(res, await useCases.listDamageType());
}

async function listInfractions(req, res) {
  return respond.ok(res, await useCases.listInfractions());
}

module.exports = {
  listUnits, listActiveClass, listWorkGroup, listDriver, listFuelType, listUser,
  listInsuranceCompany, listTypeCoverage, listUtilization, listDepartments,
  listSubDepartments, listDamageType, listInfractions, listActiveType, listCompany
};
