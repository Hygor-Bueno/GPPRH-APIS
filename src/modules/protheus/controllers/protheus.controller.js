const { ProtheusUseCases } = require('../application/protheus.use-cases');
const { SqlServerProtheusRepository } = require('../infrastructure/sqlserver-protheus.repository');

const useCases = new ProtheusUseCases({ repository: new SqlServerProtheusRepository() });

async function listCostCenters(req, res) {
  const companyCode = req.params.code;
  const data = await useCases.getCostCenters(companyCode);
  res.status(200).json({ error: false, data });
}

async function listBranches(req, res) {
  const companyCode = req.params.code;
  const data = await useCases.getBranches(companyCode);
  res.status(200).json({ error: false, data });
}

async function listAllBranches(req, res) {
  const data = await useCases.getAllBranches();
  res.status(200).json({ error: false, data });
}

async function listCompanies(req, res) {
  const data = await useCases.getCompanies();
  res.status(200).json({ error: false, data });
}

module.exports = {
  listCostCenters,
  listBranches,
  listAllBranches,
  listCompanies
};
